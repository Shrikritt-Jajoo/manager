//! manager server  —  Phase D
//!
//! Endpoints
//!   GET  /api/ping                   → 200 {"ok":true}  (server-mode detection)
//!   GET  /api/data?store=<name>       → 200 JSON array / object
//!   POST /api/data?store=<name>       → 200 {"ok":true}  (full replace)
//!   POST /api/versions/snapshot?name= → 200 {"name":"..."}
//!   GET  /api/versions               → 200 [{"name":"...","createdAt":"..."}]
//!   POST /api/versions/restore?name=  → 200 {"ok":true}
//!   DELETE /api/versions?name=        → 200 {"ok":true}
//!   GET  /*                          → static files from ./  (HTML, CSS, JS)
//!
//! Data layout on disk
//!   data/<store>.json     — live store files
//!   versions/<name>/      — snapshot directories, each containing store files

use actix_files::Files;
use actix_web::{
    delete, get, middleware, post,
    web::{self, Data, Query},
    App, HttpResponse, HttpServer, Responder,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

// ---- Config -------------------------------------------------------------

const DATA_DIR: &str     = "data";
const VERSIONS_DIR: &str = "versions";
const STATIC_DIR: &str   = ".";
const BIND_ADDR: &str    = "127.0.0.1:4000";

// Known stores — requests for unknown store names are rejected.
const VALID_STORES: &[&str] = &[
    "tasks", "subtasks", "slots", "scheduleBlocks",
    "focusSessions", "goals", "registeredAiJobs",
    "settings", "gmailConfig", "aiConfig",
];

// ---- App state ----------------------------------------------------------

struct AppState {
    // Serialise all disk writes so concurrent POST /api/data calls
    // never produce a torn file.
    write_lock: Mutex<()>,
}

// ---- Query param structs -------------------------------------------------

#[derive(Deserialize)]
struct StoreQuery {
    store: String,
}

#[derive(Deserialize)]
struct NameQuery {
    name: String,
}

// ---- Helpers ------------------------------------------------------------

fn data_path(store: &str) -> PathBuf {
    PathBuf::from(DATA_DIR).join(format!("{store}.json"))
}

fn version_dir(name: &str) -> PathBuf {
    PathBuf::from(VERSIONS_DIR).join(name)
}

fn read_store(store: &str) -> Value {
    let path = data_path(store);
    if path.exists() {
        let raw = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&raw).unwrap_or(Value::Array(vec![]))
    } else {
        Value::Array(vec![])
    }
}

fn write_store(state: &AppState, store: &str, value: &Value) -> std::io::Result<()> {
    let _guard = state.write_lock.lock().unwrap();
    fs::create_dir_all(DATA_DIR)?;
    let path = data_path(store);
    let tmp  = path.with_extension("tmp");
    let mut f = fs::File::create(&tmp)?;
    f.write_all(serde_json::to_string_pretty(value).unwrap().as_bytes())?;
    f.flush()?;
    drop(f);
    fs::rename(tmp, path)?;
    Ok(())
}

fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.')
}

// ---- /api/ping ----------------------------------------------------------

#[get("/api/ping")]
async fn api_ping() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({ "ok": true }))
}

// ---- /api/data ----------------------------------------------------------

#[get("/api/data")]
async fn api_data_get(q: Query<StoreQuery>) -> impl Responder {
    if !VALID_STORES.contains(&q.store.as_str()) {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "unknown store" }));
    }
    HttpResponse::Ok().json(read_store(&q.store))
}

#[post("/api/data")]
async fn api_data_post(
    q:     Query<StoreQuery>,
    body:  web::Json<Value>,
    state: Data<AppState>,
) -> impl Responder {
    if !VALID_STORES.contains(&q.store.as_str()) {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "unknown store" }));
    }
    match write_store(&state, &q.store, &body) {
        Ok(_)  => HttpResponse::Ok().json(serde_json::json!({ "ok": true })),
        Err(e) => HttpResponse::InternalServerError()
            .json(serde_json::json!({ "error": e.to_string() })),
    }
}

// ---- /api/versions ------------------------------------------------------

#[derive(Serialize)]
struct VersionInfo {
    name:       String,
    #[serde(rename = "createdAt")]
    created_at: String,
}

#[get("/api/versions")]
async fn api_versions_list() -> impl Responder {
    fs::create_dir_all(VERSIONS_DIR).ok();
    let mut list: Vec<VersionInfo> = fs::read_dir(VERSIONS_DIR)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    // creation time via metadata mtime, fallback to empty
                    let created_at = e
                        .metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .map(|t| {
                            let dt: chrono::DateTime<Utc> = t.into();
                            dt.to_rfc3339()
                        })
                        .unwrap_or_default();
                    VersionInfo { name, created_at }
                })
                .collect()
        })
        .unwrap_or_default();
    // newest first
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    HttpResponse::Ok().json(list)
}

#[post("/api/versions/snapshot")]
async fn api_versions_snapshot(
    q:     Query<NameQuery>,
    state: Data<AppState>,
) -> impl Responder {
    if !safe_name(&q.name) {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "invalid snapshot name" }));
    }
    let dir = version_dir(&q.name);
    if let Err(e) = fs::create_dir_all(&dir) {
        return HttpResponse::InternalServerError()
            .json(serde_json::json!({ "error": e.to_string() }));
    }
    // Copy every live store file into the snapshot dir
    let _guard = state.write_lock.lock().unwrap();
    for store in VALID_STORES {
        let src = data_path(store);
        if src.exists() {
            let dst = dir.join(format!("{store}.json"));
            fs::copy(&src, &dst).ok();
        }
    }
    HttpResponse::Ok().json(serde_json::json!({ "name": &q.name }))
}

#[post("/api/versions/restore")]
async fn api_versions_restore(
    q:     Query<NameQuery>,
    state: Data<AppState>,
) -> impl Responder {
    if !safe_name(&q.name) {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "invalid snapshot name" }));
    }
    let dir = version_dir(&q.name);
    if !dir.exists() {
        return HttpResponse::NotFound()
            .json(serde_json::json!({ "error": "snapshot not found" }));
    }
    let _guard = state.write_lock.lock().unwrap();
    for store in VALID_STORES {
        let src = dir.join(format!("{store}.json"));
        if src.exists() {
            let dst = data_path(store);
            fs::create_dir_all(DATA_DIR).ok();
            fs::copy(&src, &dst).ok();
        }
    }
    HttpResponse::Ok().json(serde_json::json!({ "ok": true }))
}

#[delete("/api/versions")]
async fn api_versions_delete(q: Query<NameQuery>) -> impl Responder {
    if !safe_name(&q.name) {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({ "error": "invalid snapshot name" }));
    }
    let dir = version_dir(&q.name);
    if dir.exists() {
        fs::remove_dir_all(&dir).ok();
    }
    HttpResponse::Ok().json(serde_json::json!({ "ok": true }))
}

// ---- main ---------------------------------------------------------------

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    fs::create_dir_all(DATA_DIR)?;
    fs::create_dir_all(VERSIONS_DIR)?;

    println!("[manager] listening on http://{BIND_ADDR}");

    let state = Data::new(AppState {
        write_lock: Mutex::new(()),
    });

    HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            // API routes — registered before static files so /api/* is never
            // accidentally served as a file.
            .service(api_ping)
            .service(api_data_get)
            .service(api_data_post)
            .service(api_versions_list)
            .service(api_versions_snapshot)
            .service(api_versions_restore)
            .service(api_versions_delete)
            // Static files — serves *.html, css/*, js/* from the project root.
            // index.html is served automatically for "/".
            .service(
                Files::new("/", STATIC_DIR)
                    .index_file("index.html")
                    .use_last_modified(true)
                    .use_etag(true),
            )
    })
    .bind(BIND_ADDR)?
    .run()
    .await
}

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncConfigPayload {
    profile_name: String,
    protocol: String,
    public_host: String,
    public_port: String,
    username: String,
    password: String,
    remote_path: String,
    remote_library_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DefaultLocalLibraryResponse {
    root_path: String,
    message: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LibraryOverviewResponse {
    resolved_storage_path: String,
    exists: bool,
    readable: bool,
    directory_count: usize,
    file_count: usize,
    sample_entries: Vec<String>,
    message: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NoteSummary {
    id: String,
    title: String,
    relative_path: String,
    folder: String,
    summary: String,
    updated_at_ms: Option<u64>,
    tags: Vec<String>,
    format: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct KnowledgeBaseIndexResponse {
    root_path: String,
    notes_root: String,
    assets_root: String,
    hidden_root: String,
    initialized_new_knowledge_base: bool,
    notes: Vec<NoteSummary>,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateNoteResponse {
    note: NoteSummary,
    message: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NoteDocumentResponse {
    note: NoteSummary,
    raw_content: String,
    frontmatter: Option<String>,
    body: String,
    message: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LibrarySnapshot {
    root_path: String,
    note_count: usize,
    asset_file_count: usize,
    latest_updated_at_ms: Option<u64>,
    has_content: bool,
    message: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncStatusResponse {
    status: String,
    configured: bool,
    reachable: bool,
    mount_point: String,
    remote_root_path: String,
    webdav_url: String,
    message: String,
    requires_initial_decision: bool,
    suggested_direction: String,
    local_snapshot: Option<LibrarySnapshot>,
    remote_snapshot: Option<LibrarySnapshot>,
    copied_count: usize,
    skipped_count: usize,
    conflict_count: usize,
    conflicts: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveNotePayload {
    note_id: String,
    body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportAssetPayload {
    note_id: String,
    file_name: String,
    base64_data: String,
    kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportAssetResponse {
    relative_asset_path: String,
    markdown_snippet: String,
    message: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NoteLinkReference {
    title: String,
    note_id: String,
    relative_path: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NoteConnectionsResponse {
    outgoing_links: Vec<NoteLinkReference>,
    backlinks: Vec<NoteLinkReference>,
    unresolved_links: Vec<String>,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenPathResponse {
    path: String,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncLibrariesPayload {
    local_root_path: String,
    config: SyncConfigPayload,
    direction: String,
    allow_initial_override: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveSyncConflictPayload {
    local_root_path: String,
    config: SyncConfigPayload,
    relative_path: String,
    resolution: String,
}

#[derive(Debug, Clone)]
struct FileInventoryEntry {
    relative_path: String,
    absolute_path: PathBuf,
    modified_at_ms: u64,
    size_bytes: u64,
    content_hash: u64,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncManifest {
    profiles: HashMap<String, SyncProfileManifest>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncProfileManifest {
    last_direction: String,
    updated_at_ms: u64,
    entries: HashMap<String, SyncManifestEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncManifestEntry {
    content_hash: u64,
    size_bytes: u64,
    updated_at_ms: u64,
}

#[derive(Debug, Default)]
struct SyncExecutionResult {
    copied_count: usize,
    skipped_count: usize,
    conflicts: Vec<String>,
}

#[derive(Debug, Clone)]
struct LibraryLayout {
    root_path: String,
    notes_root: String,
    assets_root: String,
    hidden_root: String,
    initialized_new_knowledge_base: bool,
}

#[derive(Debug, Clone)]
struct ParsedNoteRecord {
    summary: NoteSummary,
    body: String,
}

#[derive(Debug)]
struct RemoteConnection {
    mount_point: String,
    remote_root_path: String,
}

impl SyncConfigPayload {
    fn normalized_protocol(&self) -> String {
        let trimmed = self.protocol.trim().to_ascii_lowercase();
        if trimmed == "https" {
            "https".to_string()
        } else {
            "http".to_string()
        }
    }

    fn normalized_remote_path(&self) -> String {
        let trimmed = self.remote_path.trim();
        if trimmed.is_empty() {
            "//".to_string()
        } else {
            let without_leading = trimmed.trim_start_matches('/');
            format!("//{without_leading}")
        }
    }

    fn normalized_remote_library_path(&self) -> String {
        self.remote_library_path.trim_matches('/').to_string()
    }

    fn remote_collection_name(&self) -> Option<String> {
        let trimmed = self.remote_path.trim().trim_matches('/');
        trimmed
            .split('/')
            .next_back()
            .map(str::trim)
            .filter(|segment| !segment.is_empty())
            .map(ToString::to_string)
    }

    fn mount_point(&self) -> String {
        self.remote_collection_name()
            .map(|collection| format!("/Volumes/{collection}"))
            .unwrap_or_else(|| "/Volumes/WebDAV".to_string())
    }

    fn remote_root_path_for_mount_point(&self, mount_point: &str) -> String {
        let normalized_path = self.normalized_remote_library_path();
        if normalized_path.is_empty() {
            mount_point.to_string()
        } else {
            format!("{mount_point}/{normalized_path}")
        }
    }

    fn webdav_url(&self) -> String {
        let protocol = self.normalized_protocol();
        let host = self.public_host.trim();
        let port = self.public_port.trim();
        let remote_path = self.normalized_remote_path();
        let credentials = if self.username.trim().is_empty() {
            String::new()
        } else if self.password.is_empty() {
            format!("{}@", percent_encode(self.username.trim()))
        } else {
            format!(
                "{}:{}@",
                percent_encode(self.username.trim()),
                percent_encode(&self.password)
            )
        };
        let port_segment = if port.is_empty() {
            String::new()
        } else {
            format!(":{port}")
        };

        format!("{protocol}://{credentials}{host}{port_segment}{}", remote_path)
    }
}

fn percent_encode(input: &str) -> String {
    let mut output = String::new();

    for byte in input.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            output.push(byte as char);
        } else {
            output.push_str(&format!("%{:02X}", byte));
        }
    }

    output
}

fn normalize_root_path(root_path: &str) -> String {
    root_path.trim().trim_end_matches('/').to_string()
}

fn default_local_library_path() -> Result<String, String> {
    let home = env::var("HOME").map_err(|error| format!("Failed to read HOME for local library path: {error}"))?;
    Ok(format!("{home}/Documents/NoteBase"))
}

fn sync_profile_key(config: &SyncConfigPayload, remote_root_path: &str) -> String {
    format!("{}|{}", config.webdav_url(), remote_root_path)
}

fn ensure_library_layout(root_path: &str) -> Result<LibraryLayout, String> {
    let normalized_root = normalize_root_path(root_path);
    if normalized_root.is_empty() {
        return Err("A knowledge base root path is required.".to_string());
    }

    let notes_root = format!("{normalized_root}/notes");
    let assets_root = format!("{normalized_root}/assets");
    let hidden_root = format!("{normalized_root}/.notebase");
    let directories = [
        normalized_root.clone(),
        notes_root.clone(),
        format!("{notes_root}/inbox"),
        format!("{notes_root}/projects"),
        format!("{notes_root}/topics"),
        assets_root.clone(),
        format!("{assets_root}/images"),
        format!("{assets_root}/files"),
        hidden_root.clone(),
    ];

    let initialized_new_knowledge_base = match fs::read_dir(&normalized_root) {
        Ok(mut entries) => entries.next().is_none(),
        Err(_) => true,
    };

    for directory in directories {
        fs::create_dir_all(&directory)
            .map_err(|error| format!("Failed to create knowledge base directory {directory}: {error}"))?;
    }

    Ok(LibraryLayout {
        root_path: normalized_root,
        notes_root,
        assets_root,
        hidden_root,
        initialized_new_knowledge_base,
    })
}

fn layout_to_index_response(layout: &LibraryLayout, message: String) -> KnowledgeBaseIndexResponse {
    KnowledgeBaseIndexResponse {
        root_path: layout.root_path.clone(),
        notes_root: layout.notes_root.clone(),
        assets_root: layout.assets_root.clone(),
        hidden_root: layout.hidden_root.clone(),
        initialized_new_knowledge_base: layout.initialized_new_knowledge_base,
        notes: Vec::new(),
        message,
    }
}

fn sync_manifest_path(local_root_path: &str) -> Result<PathBuf, String> {
    let layout = ensure_library_layout(local_root_path)?;
    Ok(Path::new(&layout.hidden_root).join("sync-manifest.json"))
}

fn load_sync_manifest(local_root_path: &str) -> Result<SyncManifest, String> {
    let path = sync_manifest_path(local_root_path)?;
    if !path.exists() {
        return Ok(SyncManifest::default());
    }

    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read sync manifest {}: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("Failed to parse sync manifest {}: {error}", path.display()))
}

fn save_sync_manifest(local_root_path: &str, manifest: &SyncManifest) -> Result<(), String> {
    let path = sync_manifest_path(local_root_path)?;
    let raw = serde_json::to_string_pretty(manifest)
        .map_err(|error| format!("Failed to serialize sync manifest: {error}"))?;
    fs::write(&path, raw)
        .map_err(|error| format!("Failed to write sync manifest {}: {error}", path.display()))
}

fn collect_markdown_files(directory: &Path, output: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("Failed to read notes directory {}: {error}", directory.display()))?;

    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "Failed while iterating notes directory {}: {error}",
                directory.display()
            )
        })?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "Failed to inspect an entry in notes directory {}: {error}",
                directory.display()
            )
        })?;

        if file_type.is_dir() {
            collect_markdown_files(&path, output)?;
        } else if file_type.is_file()
            && path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            output.push(path);
        }
    }

    Ok(())
}

fn collect_all_files(directory: &Path, output: &mut Vec<PathBuf>) -> Result<(), String> {
    if !directory.exists() {
        return Ok(());
    }

    let entries = fs::read_dir(directory)
        .map_err(|error| format!("Failed to read directory {}: {error}", directory.display()))?;

    for entry in entries {
        let entry = entry
            .map_err(|error| format!("Failed while iterating directory {}: {error}", directory.display()))?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "Failed to inspect an entry in directory {}: {error}",
                directory.display()
            )
        })?;

        if file_type.is_dir() {
            collect_all_files(&path, output)?;
        } else if file_type.is_file() {
            output.push(path);
        }
    }

    Ok(())
}

fn parse_frontmatter_block(content: &str) -> (Option<&str>, &str) {
    if !content.starts_with("---\n") {
        return (None, content);
    }

    if let Some(end_index) = content[4..].find("\n---\n") {
        let frontmatter_end = 4 + end_index;
        let frontmatter = &content[4..frontmatter_end];
        let body = &content[(frontmatter_end + 5)..];
        (Some(frontmatter), body)
    } else {
        (None, content)
    }
}

fn slugify_filename_stem(input: &str) -> String {
    let mut slug = String::new();

    for character in input.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
        } else if matches!(character, ' ' | '-' | '_' | '.') {
            if !slug.ends_with('-') {
                slug.push('-');
            }
        }
    }

    slug.trim_matches('-').to_string()
}

fn sanitize_import_filename(file_name: &str, timestamp_ms: u64) -> String {
    let path = Path::new(file_name);
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .filter(|extension| !extension.is_empty());
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(slugify_filename_stem)
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "asset".to_string());

    match extension {
        Some(extension) => format!("{stem}-{timestamp_ms}.{extension}"),
        None => format!("{stem}-{timestamp_ms}"),
    }
}

fn relative_path_from(from_directory: &Path, to_path: &Path) -> PathBuf {
    let from_components: Vec<_> = from_directory
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_owned()),
            _ => None,
        })
        .collect();
    let to_components: Vec<_> = to_path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_owned()),
            _ => None,
        })
        .collect();

    let mut shared_prefix_len = 0;
    while shared_prefix_len < from_components.len()
        && shared_prefix_len < to_components.len()
        && from_components[shared_prefix_len] == to_components[shared_prefix_len]
    {
        shared_prefix_len += 1;
    }

    let mut relative_path = PathBuf::new();
    for _ in shared_prefix_len..from_components.len() {
        relative_path.push("..");
    }
    for component in to_components.iter().skip(shared_prefix_len) {
        relative_path.push(component);
    }

    relative_path
}

fn extract_frontmatter_value(frontmatter: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}:");
    let lines: Vec<&str> = frontmatter.lines().collect();
    let mut index = 0;

    while index < lines.len() {
        let trimmed = lines[index].trim();
        if !trimmed.starts_with(&prefix) {
            index += 1;
            continue;
        }

        let value = trimmed[prefix.len()..].trim();
        if !value.is_empty() {
            return Some(value.trim_matches('"').trim_matches('\'').to_string());
        }

        let mut nested = Vec::new();
        index += 1;
        while index < lines.len() {
            let nested_line = lines[index].trim();
            if let Some(tag) = nested_line.strip_prefix("- ") {
                nested.push(tag.trim().trim_matches('"').trim_matches('\'').to_string());
                index += 1;
                continue;
            }
            break;
        }

        if !nested.is_empty() {
            return Some(nested.join(", "));
        }
    }

    None
}

fn extract_tags(frontmatter: Option<&str>) -> Vec<String> {
    let Some(frontmatter) = frontmatter else {
        return Vec::new();
    };

    let Some(raw_tags) = extract_frontmatter_value(frontmatter, "tags") else {
        return Vec::new();
    };

    raw_tags
        .trim_matches('[')
        .trim_matches(']')
        .split(',')
        .map(str::trim)
        .filter(|tag| !tag.is_empty())
        .map(|tag| tag.trim_matches('"').trim_matches('\'').to_string())
        .collect()
}

fn derive_title(frontmatter: Option<&str>, body: &str, fallback: &str) -> String {
    if let Some(frontmatter) = frontmatter {
        if let Some(title) = extract_frontmatter_value(frontmatter, "title") {
            if !title.is_empty() {
                return title;
            }
        }
    }

    for line in body.lines() {
        let trimmed = line.trim();
        if let Some(title) = trimmed.strip_prefix("# ") {
            if !title.trim().is_empty() {
                return title.trim().to_string();
            }
        }
    }

    fallback.to_string()
}

fn derive_summary(body: &str) -> String {
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('#')
            || trimmed.starts_with("```")
            || trimmed.starts_with("---")
        {
            continue;
        }

        return trimmed.chars().take(140).collect();
    }

    "No preview text yet.".to_string()
}

fn note_updated_at_ms(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

fn file_size_bytes(path: &Path) -> Option<u64> {
    fs::metadata(path).ok().map(|metadata| metadata.len())
}

fn file_content_hash(path: &Path) -> Result<u64, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("Failed to read file {} for hashing: {error}", path.display()))?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    Ok(hasher.finish())
}

fn current_timestamp_ms() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| format!("Failed to read system time: {error}"))
}

fn slugify_title(title: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;

    for character in title.chars() {
        let normalized = character.to_ascii_lowercase();
        if normalized.is_ascii_alphanumeric() {
            slug.push(normalized);
            last_was_dash = false;
        } else if !last_was_dash {
            slug.push('-');
            last_was_dash = true;
        }
    }

    let trimmed = slug.trim_matches('-');
    if trimmed.is_empty() {
        "untitled-note".to_string()
    } else {
        trimmed.to_string()
    }
}

fn derive_title_from_body(body: &str, fallback: &str) -> String {
    for line in body.lines() {
        let trimmed = line.trim();
        if let Some(title) = trimmed.strip_prefix("# ") {
            let title = title.trim();
            if !title.is_empty() {
                return title.to_string();
            }
        }
    }

    fallback.to_string()
}

fn replace_frontmatter_value(lines: &mut Vec<String>, key: &str, value: String) {
    let prefix = format!("{key}:");

    if let Some(line) = lines
        .iter_mut()
        .find(|line| line.trim_start().starts_with(&prefix))
    {
        *line = format!("{key}: {value}");
        return;
    }

    lines.push(format!("{key}: {value}"));
}

fn has_frontmatter_key(frontmatter: Option<&str>, key: &str) -> bool {
    let Some(frontmatter) = frontmatter else {
        return false;
    };

    let prefix = format!("{key}:");
    frontmatter
        .lines()
        .any(|line| line.trim_start().starts_with(&prefix))
}

fn build_note_content(
    existing_frontmatter: Option<&str>,
    body: &str,
    fallback_title: &str,
    fallback_note_id: &str,
    timestamp_ms: u64,
) -> String {
    let normalized_body = body.replace("\r\n", "\n");
    let trimmed_body = normalized_body.trim_end_matches('\n');
    let existing_title = existing_frontmatter
        .and_then(|frontmatter| extract_frontmatter_value(frontmatter, "title"))
        .filter(|title| !title.trim().is_empty())
        .unwrap_or_else(|| fallback_title.to_string());
    let title = derive_title_from_body(trimmed_body, &existing_title);
    let note_id = existing_frontmatter
        .and_then(|frontmatter| extract_frontmatter_value(frontmatter, "id"))
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| fallback_note_id.to_string());
    let created_at_ms = existing_frontmatter
        .and_then(|frontmatter| extract_frontmatter_value(frontmatter, "createdAtMs"))
        .filter(|created_at| !created_at.trim().is_empty())
        .unwrap_or_else(|| timestamp_ms.to_string());
    let mut frontmatter_lines = existing_frontmatter
        .map(|frontmatter| {
            frontmatter
                .lines()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    replace_frontmatter_value(&mut frontmatter_lines, "id", note_id);
    replace_frontmatter_value(&mut frontmatter_lines, "title", title);
    replace_frontmatter_value(&mut frontmatter_lines, "createdAtMs", created_at_ms);
    replace_frontmatter_value(
        &mut frontmatter_lines,
        "updatedAtMs",
        timestamp_ms.to_string(),
    );

    if !has_frontmatter_key(existing_frontmatter, "tags") {
        frontmatter_lines.push("tags: []".to_string());
    }

    let body_with_trailing_newline = if trimmed_body.is_empty() {
        String::new()
    } else {
        format!("{trimmed_body}\n")
    };

    format!(
        "---\n{}\n---\n\n{}",
        frontmatter_lines.join("\n"),
        body_with_trailing_newline
    )
}

fn parse_note_summary(path: &Path, notes_root: &Path) -> Result<NoteSummary, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read note file {}: {error}", path.display()))?;
    let (frontmatter, body) = parse_frontmatter_block(&content);
    let relative_path = path
        .strip_prefix(notes_root)
        .map_err(|error| {
            format!(
                "Failed to resolve relative note path for {}: {error}",
                path.display()
            )
        })?
        .to_string_lossy()
        .replace('\\', "/");
    let file_stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("Untitled note");
    let folder = Path::new(&relative_path)
        .parent()
        .map(|parent| parent.to_string_lossy().replace('\\', "/"))
        .filter(|parent| !parent.is_empty())
        .unwrap_or_else(|| "notes".to_string());

    Ok(NoteSummary {
        id: relative_path.clone(),
        title: derive_title(frontmatter, body, file_stem),
        relative_path,
        folder,
        summary: derive_summary(body),
        updated_at_ms: note_updated_at_ms(path),
        tags: extract_tags(frontmatter),
        format: "markdown".to_string(),
    })
}

fn resolve_note_path(notes_root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Note path must be relative to the notes root.".to_string());
    }

    Ok(notes_root.join(relative))
}

fn canonicalize_link_target(input: &str) -> String {
    input
        .split('|')
        .next()
        .unwrap_or(input)
        .split('#')
        .next()
        .unwrap_or(input)
        .trim()
        .to_ascii_lowercase()
}

fn note_reference_keys(summary: &NoteSummary) -> Vec<String> {
    let mut keys = vec![summary.title.trim().to_ascii_lowercase()];
    let relative_without_extension = summary
        .relative_path
        .strip_suffix(".md")
        .unwrap_or(&summary.relative_path)
        .to_ascii_lowercase();
    keys.push(relative_without_extension.clone());

    if let Some(file_stem) = Path::new(&summary.relative_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
    {
        keys.push(file_stem.to_ascii_lowercase());
    }

    keys.sort();
    keys.dedup();
    keys
}

fn extract_wikilinks(body: &str) -> Vec<String> {
    let mut links = Vec::new();
    let mut cursor = 0;

    while let Some(start) = body[cursor..].find("[[") {
        let absolute_start = cursor + start + 2;
        if let Some(end) = body[absolute_start..].find("]]") {
            let absolute_end = absolute_start + end;
            let target = body[absolute_start..absolute_end].trim();
            if !target.is_empty() {
                links.push(target.to_string());
            }
            cursor = absolute_end + 2;
        } else {
            break;
        }
    }

    links
}

fn load_parsed_notes(root_path: &str) -> Result<Vec<ParsedNoteRecord>, String> {
    let layout = ensure_library_layout(root_path)?;
    let notes_root = Path::new(&layout.notes_root);
    let mut markdown_files = Vec::new();
    collect_markdown_files(notes_root, &mut markdown_files)?;

    let mut parsed_notes = Vec::new();
    for path in markdown_files {
        let content = fs::read_to_string(&path)
            .map_err(|error| format!("Failed to read note file {}: {error}", path.display()))?;
        let (_, body) = parse_frontmatter_block(&content);
        let summary = parse_note_summary(&path, notes_root)?;
        parsed_notes.push(ParsedNoteRecord {
            summary,
            body: body.to_string(),
        });
    }

    Ok(parsed_notes)
}

fn build_library_snapshot(root_path: &str) -> Result<LibrarySnapshot, String> {
    let layout = ensure_library_layout(root_path)?;
    let notes_root = Path::new(&layout.notes_root);
    let assets_root = Path::new(&layout.assets_root);

    let mut markdown_files = Vec::new();
    let mut asset_files = Vec::new();

    collect_markdown_files(notes_root, &mut markdown_files)?;
    collect_all_files(assets_root, &mut asset_files)?;

    let latest_updated_at_ms = markdown_files
        .iter()
        .chain(asset_files.iter())
        .filter_map(|path| note_updated_at_ms(path))
        .max();

    Ok(LibrarySnapshot {
        root_path: layout.root_path,
        note_count: markdown_files.len(),
        asset_file_count: asset_files.len(),
        latest_updated_at_ms,
        has_content: !markdown_files.is_empty() || !asset_files.is_empty(),
        message: format!(
            "Snapshot ready with {} markdown notes and {} asset files.",
            markdown_files.len(),
            asset_files.len()
        ),
    })
}

fn build_file_inventory(root_path: &str) -> Result<HashMap<String, FileInventoryEntry>, String> {
    let layout = ensure_library_layout(root_path)?;
    let mut files = Vec::new();
    let notes_root = Path::new(&layout.notes_root);
    let assets_root = Path::new(&layout.assets_root);

    collect_all_files(notes_root, &mut files)?;
    collect_all_files(assets_root, &mut files)?;

    let mut inventory = HashMap::new();

    for path in files {
        let relative = path
            .strip_prefix(&layout.root_path)
            .map_err(|error| {
                format!(
                    "Failed to resolve inventory-relative path for {}: {error}",
                    path.display()
                )
            })?
            .to_string_lossy()
            .replace('\\', "/");
        let modified_at_ms = note_updated_at_ms(&path).unwrap_or(0);
        let size_bytes = file_size_bytes(&path).unwrap_or(0);
        let content_hash = file_content_hash(&path)?;

        inventory.insert(
            relative.clone(),
            FileInventoryEntry {
                relative_path: relative,
                absolute_path: path,
                modified_at_ms,
                size_bytes,
                content_hash,
            },
        );
    }

    Ok(inventory)
}

fn preview_sync_operation(
    source_inventory: &HashMap<String, FileInventoryEntry>,
    destination_inventory: &HashMap<String, FileInventoryEntry>,
    manifest_entries: &HashMap<String, SyncManifestEntry>,
    allow_initial_override: bool,
) -> SyncExecutionResult {
    let mut result = SyncExecutionResult::default();

    for source_entry in source_inventory.values() {
        match destination_inventory.get(&source_entry.relative_path) {
            None => {
                result.copied_count += 1;
            }
            Some(destination_entry) => {
                if source_entry.content_hash == destination_entry.content_hash
                    && source_entry.size_bytes == destination_entry.size_bytes
                {
                    result.skipped_count += 1;
                    continue;
                }

                let manifest_entry = manifest_entries.get(&source_entry.relative_path);
                let source_matches_manifest = manifest_entry
                    .map(|entry| {
                        entry.content_hash == source_entry.content_hash
                            && entry.size_bytes == source_entry.size_bytes
                    })
                    .unwrap_or(false);
                let destination_matches_manifest = manifest_entry
                    .map(|entry| {
                        entry.content_hash == destination_entry.content_hash
                            && entry.size_bytes == destination_entry.size_bytes
                    })
                    .unwrap_or(false);

                let should_copy = if allow_initial_override && manifest_entry.is_none() {
                    true
                } else if !source_matches_manifest && destination_matches_manifest {
                    true
                } else if source_matches_manifest && !destination_matches_manifest {
                    false
                } else if manifest_entry.is_none() {
                    false
                } else {
                    false
                };

                if should_copy {
                    result.copied_count += 1;
                } else {
                    result.conflicts.push(source_entry.relative_path.clone());
                }
            }
        }
    }

    result
}

fn upsert_manifest_entry(
    profile_manifest: &mut SyncProfileManifest,
    relative_path: String,
    source_entry: &FileInventoryEntry,
    timestamp_ms: u64,
    direction: &str,
) {
    profile_manifest.entries.insert(
        relative_path,
        SyncManifestEntry {
            content_hash: source_entry.content_hash,
            size_bytes: source_entry.size_bytes,
            updated_at_ms: source_entry.modified_at_ms,
        },
    );
    profile_manifest.updated_at_ms = timestamp_ms;
    profile_manifest.last_direction = direction.to_string();
}

fn inspect_library_internal(root_path: &str) -> Result<LibraryOverviewResponse, String> {
    let layout = ensure_library_layout(root_path)?;
    let path = Path::new(&layout.root_path);

    let entries = fs::read_dir(path)
        .map_err(|error| format!("Failed to read knowledge base directory {}: {error}", layout.root_path))?;

    let mut directory_count = 0;
    let mut file_count = 0;
    let mut sample_entries = Vec::new();

    for entry in entries {
        let entry = entry
            .map_err(|error| format!("Failed while iterating knowledge base directory {}: {error}", layout.root_path))?;
        let entry_type = entry.file_type().map_err(|error| {
            format!(
                "Failed to inspect an entry in knowledge base directory {}: {error}",
                layout.root_path
            )
        })?;

        let mut label = entry.file_name().to_string_lossy().to_string();
        if entry_type.is_dir() {
            directory_count += 1;
            label.push('/');
        } else if entry_type.is_file() {
            file_count += 1;
        }

        if sample_entries.len() < 8 {
            sample_entries.push(label);
        }
    }

    Ok(LibraryOverviewResponse {
        resolved_storage_path: layout.root_path,
        exists: true,
        readable: true,
        directory_count,
        file_count,
        sample_entries,
        message: "Local knowledge base directory is ready.".to_string(),
    })
}

fn load_library_index_internal(root_path: &str) -> Result<KnowledgeBaseIndexResponse, String> {
    let layout = ensure_library_layout(root_path)?;
    let notes_root_path = Path::new(&layout.notes_root);
    let mut markdown_files = Vec::new();
    collect_markdown_files(notes_root_path, &mut markdown_files)?;

    let mut notes = markdown_files
        .iter()
        .map(|path| parse_note_summary(path, notes_root_path))
        .collect::<Result<Vec<_>, _>>()?;

    notes.sort_by(|left, right| right.updated_at_ms.cmp(&left.updated_at_ms));
    let note_count = notes.len();
    let mut response = layout_to_index_response(
        &layout,
        if layout.initialized_new_knowledge_base {
            format!("A new local knowledge base was created and {note_count} markdown notes were indexed.")
        } else {
            format!("Local knowledge base is ready and {note_count} markdown notes were indexed.")
        },
    );
    response.notes = notes;
    Ok(response)
}

fn probe_webdav_endpoint(config: &SyncConfigPayload) -> Option<String> {
    let credentials = if config.username.trim().is_empty() {
        None
    } else {
        Some(format!("{}:{}", config.username.trim(), config.password))
    };

    let mut command = Command::new("/usr/bin/curl");
    command
        .arg("-sS")
        .arg("-I")
        .arg("--connect-timeout")
        .arg("5")
        .arg("--max-time")
        .arg("10")
        .arg("-X")
        .arg("OPTIONS");

    if let Some(credentials) = credentials {
        command.arg("-u").arg(credentials);
    }

    let output = command.arg(config.webdav_url()).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let headers = String::from_utf8_lossy(&output.stdout);
    if headers.contains("Dav:") || headers.contains("DAV:") {
        Some("Remote WebDAV endpoint is reachable.".to_string())
    } else {
        None
    }
}

fn try_mount_webdav(config: &SyncConfigPayload) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "try
set mountedAlias to mount volume \"{}\"
return POSIX path of mountedAlias
on error errMsg number errNum
return \"ERROR \" & errNum & \": \" & errMsg
end try",
            config.webdav_url()
        );
        let output = Command::new("/usr/bin/osascript")
            .arg("-e")
            .arg(script)
            .output()
            .map_err(|error| format!("Failed to launch macOS mount volume: {error}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let detail = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                "mount volume returned a non-zero exit status.".to_string()
            };
            return Err(format!("Automatic mount attempt failed: {detail}"));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stdout.starts_with("ERROR ") {
            Err(format!("Automatic mount attempt failed: {stdout}"))
        } else {
            Ok(stdout.trim_end_matches('/').to_string())
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = config;
        Err("Automatic WebDAV mounting is currently implemented for macOS only.".to_string())
    }
}

fn connect_remote_library(config: &SyncConfigPayload) -> Result<RemoteConnection, String> {
    let expected_mount_point = config.mount_point();
    let expected_remote_root = config.remote_root_path_for_mount_point(&expected_mount_point);
    if Path::new(&expected_remote_root).exists() {
        let layout = ensure_library_layout(&expected_remote_root)?;
        return Ok(RemoteConnection {
            mount_point: expected_mount_point,
            remote_root_path: layout.root_path,
        });
    }

    if Path::new(&expected_mount_point).exists() {
        let layout = ensure_library_layout(&expected_remote_root)?;
        return Ok(RemoteConnection {
            mount_point: expected_mount_point,
            remote_root_path: layout.root_path,
        });
    }

    probe_webdav_endpoint(config)
        .ok_or_else(|| "Remote WebDAV endpoint did not confirm as reachable from the local app check.".to_string())?;
    let mounted_path = try_mount_webdav(config)?;
    let remote_root_path = config.remote_root_path_for_mount_point(&mounted_path);
    let layout = ensure_library_layout(&remote_root_path)?;

    Ok(RemoteConnection {
        mount_point: mounted_path,
        remote_root_path: layout.root_path,
    })
}

fn sync_status_from_error(config: &SyncConfigPayload, message: String) -> SyncStatusResponse {
    SyncStatusResponse {
        status: "failed".to_string(),
        configured: true,
        reachable: false,
        mount_point: config.mount_point(),
        remote_root_path: config.remote_root_path_for_mount_point(&config.mount_point()),
        webdav_url: config.webdav_url(),
        message,
        requires_initial_decision: false,
        suggested_direction: "none".to_string(),
        local_snapshot: None,
        remote_snapshot: None,
        copied_count: 0,
        skipped_count: 0,
        conflict_count: 0,
        conflicts: Vec::new(),
    }
}

fn snapshots_match(local: &LibrarySnapshot, remote: &LibrarySnapshot) -> bool {
    local.note_count == remote.note_count
        && local.asset_file_count == remote.asset_file_count
        && local.latest_updated_at_ms == remote.latest_updated_at_ms
}

fn suggested_sync_direction(local: &LibrarySnapshot, remote: &LibrarySnapshot) -> String {
    if !local.has_content && remote.has_content {
        "pull_remote_to_local".to_string()
    } else if local.has_content && !remote.has_content {
        "push_local_to_remote".to_string()
    } else if local.latest_updated_at_ms.unwrap_or(0) >= remote.latest_updated_at_ms.unwrap_or(0) {
        "push_local_to_remote".to_string()
    } else {
        "pull_remote_to_local".to_string()
    }
}

fn build_sync_status_response(
    local_root_path: &str,
    config: &SyncConfigPayload,
    connection: &RemoteConnection,
    status_override: Option<&str>,
    message_override: Option<String>,
    copied_count: usize,
    skipped_count: usize,
) -> Result<SyncStatusResponse, String> {
    let local_snapshot = build_library_snapshot(local_root_path)?;
    let remote_snapshot = build_library_snapshot(&connection.remote_root_path)?;
    let snapshots_are_equal = snapshots_match(&local_snapshot, &remote_snapshot);
    let manifest = load_sync_manifest(local_root_path)?;
    let profile_key = sync_profile_key(config, &connection.remote_root_path);
    let profile_manifest = manifest
        .profiles
        .get(&profile_key)
        .cloned()
        .unwrap_or(SyncProfileManifest {
            last_direction: "push_local_to_remote".to_string(),
            updated_at_ms: 0,
            entries: HashMap::new(),
        });
    let local_inventory = build_file_inventory(local_root_path)?;
    let remote_inventory = build_file_inventory(&connection.remote_root_path)?;
    let preview = preview_sync_operation(
        if profile_manifest.last_direction == "pull_remote_to_local" {
            &remote_inventory
        } else {
            &local_inventory
        },
        if profile_manifest.last_direction == "pull_remote_to_local" {
            &local_inventory
        } else {
            &remote_inventory
        },
        &profile_manifest.entries,
        false,
    );
    let conflict_count = preview.conflicts.len();
    let suggested_direction = if snapshots_are_equal {
        "none".to_string()
    } else {
        suggested_sync_direction(&local_snapshot, &remote_snapshot)
    };
    let status = status_override
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            if conflict_count > 0 {
                "conflicted".to_string()
            } else if snapshots_are_equal {
                "synced".to_string()
            } else {
                "connected".to_string()
            }
        });
    let message = message_override.unwrap_or_else(|| {
        if conflict_count > 0 {
            format!(
                "{} copied {} files, skipped {} unchanged files, and found {} remaining conflicts that need manual resolution.",
                config.profile_name, copied_count, skipped_count, conflict_count
            )
        } else if snapshots_are_equal {
            format!(
                "{} is aligned. Copied {} files and skipped {} unchanged files.",
                config.profile_name, copied_count, skipped_count
            )
        } else {
            format!(
                "{} is connected. Copied {} files and skipped {} unchanged files.",
                config.profile_name, copied_count, skipped_count
            )
        }
    });

    Ok(SyncStatusResponse {
        status,
        configured: true,
        reachable: true,
        mount_point: connection.mount_point.clone(),
        remote_root_path: connection.remote_root_path.clone(),
        webdav_url: config.webdav_url(),
        message,
        requires_initial_decision: false,
        suggested_direction,
        local_snapshot: Some(local_snapshot),
        remote_snapshot: Some(remote_snapshot),
        copied_count,
        skipped_count,
        conflict_count,
        conflicts: preview.conflicts,
    })
}

fn copy_file(source: &Path, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create parent directory {}: {error}", parent.display()))?;
    }
    fs::copy(source, destination)
        .map_err(|error| format!("Failed to copy file {} to {}: {error}", source.display(), destination.display()))?;
    Ok(())
}

fn sync_library_contents(
    local_root_path: &str,
    source_root: &str,
    destination_root: &str,
    config: &SyncConfigPayload,
    direction: &str,
    allow_initial_override: bool,
) -> Result<SyncExecutionResult, String> {
    let destination_layout = ensure_library_layout(destination_root)?;
    let timestamp_ms = current_timestamp_ms()?;
    let source_inventory = build_file_inventory(source_root)?;
    let destination_inventory = build_file_inventory(destination_root)?;
    let mut manifest = load_sync_manifest(local_root_path)?;
    let remote_root_path = if source_root == local_root_path {
        destination_root
    } else {
        source_root
    };
    let profile_key = sync_profile_key(config, remote_root_path);
    let profile_manifest = manifest
        .profiles
        .entry(profile_key)
        .or_insert_with(|| SyncProfileManifest {
            last_direction: direction.to_string(),
            updated_at_ms: 0,
            entries: HashMap::new(),
        });
    let preview = preview_sync_operation(
        &source_inventory,
        &destination_inventory,
        &profile_manifest.entries,
        allow_initial_override,
    );
    let mut result = SyncExecutionResult {
        copied_count: 0,
        skipped_count: preview.skipped_count,
        conflicts: preview.conflicts.clone(),
    };

    for source_entry in source_inventory.values() {
        let destination_path = Path::new(&destination_layout.root_path).join(&source_entry.relative_path);
        if preview.conflicts.contains(&source_entry.relative_path) {
            continue;
        }

        match destination_inventory.get(&source_entry.relative_path) {
            Some(destination_entry)
                if source_entry.content_hash == destination_entry.content_hash
                    && source_entry.size_bytes == destination_entry.size_bytes =>
            {
                upsert_manifest_entry(
                    profile_manifest,
                    source_entry.relative_path.clone(),
                    source_entry,
                    timestamp_ms,
                    direction,
                );
            }
            _ => {
                copy_file(&source_entry.absolute_path, &destination_path)?;
                result.copied_count += 1;
                upsert_manifest_entry(
                    profile_manifest,
                    source_entry.relative_path.clone(),
                    source_entry,
                    timestamp_ms,
                    direction,
                );
            }
        }
    }

    save_sync_manifest(local_root_path, &manifest)?;
    Ok(result)
}

#[tauri::command]
fn get_default_local_library() -> Result<DefaultLocalLibraryResponse, String> {
    let root_path = default_local_library_path()?;
    ensure_library_layout(&root_path)?;
    Ok(DefaultLocalLibraryResponse {
        root_path,
        message: "Default offline knowledge base path is ready.".to_string(),
    })
}

#[tauri::command]
fn inspect_library(root_path: String) -> Result<LibraryOverviewResponse, String> {
    inspect_library_internal(&root_path)
}

#[tauri::command]
fn load_library_index(root_path: String) -> Result<KnowledgeBaseIndexResponse, String> {
    load_library_index_internal(&root_path)
}

#[tauri::command]
fn create_note(root_path: String) -> Result<CreateNoteResponse, String> {
    let layout = ensure_library_layout(&root_path)?;
    let timestamp_ms = current_timestamp_ms()?;
    let title = "Untitled note";
    let slug = slugify_title(title);
    let relative_path = format!("inbox/{}-{}.md", slug, timestamp_ms);
    let note_path = Path::new(&layout.notes_root).join(&relative_path);

    let content = format!(
        "---\nid: note-{timestamp_ms}\ntitle: {title}\ncreatedAtMs: {timestamp_ms}\nupdatedAtMs: {timestamp_ms}\ntags: []\n---\n\n# {title}\n\nStart writing...\n"
    );

    fs::write(&note_path, content)
        .map_err(|error| format!("Failed to create note file {}: {error}", note_path.display()))?;

    let note = parse_note_summary(&note_path, Path::new(&layout.notes_root))?;
    let created_relative_path = note.relative_path.clone();

    Ok(CreateNoteResponse {
        note,
        message: format!("Created the first note at {}.", created_relative_path),
    })
}

#[tauri::command]
fn load_note_document(root_path: String, note_id: String) -> Result<NoteDocumentResponse, String> {
    let layout = ensure_library_layout(&root_path)?;
    let notes_root = Path::new(&layout.notes_root);
    let note_path = resolve_note_path(notes_root, &note_id)?;
    let raw_content = fs::read_to_string(&note_path)
        .map_err(|error| format!("Failed to read note file {}: {error}", note_path.display()))?;
    let (frontmatter, body) = parse_frontmatter_block(&raw_content);
    let note = parse_note_summary(&note_path, notes_root)?;
    let loaded_relative_path = note.relative_path.clone();

    Ok(NoteDocumentResponse {
        note,
        raw_content: raw_content.clone(),
        frontmatter: frontmatter.map(ToString::to_string),
        body: body.to_string(),
        message: format!("Loaded note content from {}.", loaded_relative_path),
    })
}

#[tauri::command]
fn save_note_document(
    root_path: String,
    payload: SaveNotePayload,
) -> Result<NoteDocumentResponse, String> {
    let layout = ensure_library_layout(&root_path)?;
    let notes_root = Path::new(&layout.notes_root);
    let note_path = resolve_note_path(notes_root, &payload.note_id)?;
    let existing_raw_content = fs::read_to_string(&note_path)
        .map_err(|error| format!("Failed to read note file {}: {error}", note_path.display()))?;
    let (existing_frontmatter, _) = parse_frontmatter_block(&existing_raw_content);
    let fallback_title = note_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("Untitled note");
    let timestamp_ms = current_timestamp_ms()?;
    let next_content = build_note_content(
        existing_frontmatter,
        &payload.body,
        fallback_title,
        &format!("note-{timestamp_ms}"),
        timestamp_ms,
    );

    fs::write(&note_path, &next_content)
        .map_err(|error| format!("Failed to save note file {}: {error}", note_path.display()))?;

    let raw_content = fs::read_to_string(&note_path)
        .map_err(|error| format!("Failed to re-read note file {}: {error}", note_path.display()))?;
    let (frontmatter, body) = parse_frontmatter_block(&raw_content);
    let note = parse_note_summary(&note_path, notes_root)?;
    let saved_relative_path = note.relative_path.clone();

    Ok(NoteDocumentResponse {
        note,
        raw_content: raw_content.clone(),
        frontmatter: frontmatter.map(ToString::to_string),
        body: body.to_string(),
        message: format!("Saved note content to {}.", saved_relative_path),
    })
}

#[tauri::command]
fn import_asset(root_path: String, payload: ImportAssetPayload) -> Result<ImportAssetResponse, String> {
    let layout = ensure_library_layout(&root_path)?;
    let notes_root = Path::new(&layout.notes_root);
    let note_path = resolve_note_path(notes_root, &payload.note_id)?;
    let note_directory = note_path
        .parent()
        .ok_or_else(|| format!("Failed to resolve a parent directory for {}.", note_path.display()))?;
    let timestamp_ms = current_timestamp_ms()?;
    let asset_file_name = sanitize_import_filename(&payload.file_name, timestamp_ms);
    let target_directory = if payload.kind.trim().eq_ignore_ascii_case("image") {
        Path::new(&layout.assets_root).join("images")
    } else {
        Path::new(&layout.assets_root).join("files")
    };
    let asset_path = target_directory.join(&asset_file_name);
    let asset_bytes = BASE64_STANDARD
        .decode(&payload.base64_data)
        .map_err(|error| format!("Failed to decode asset payload for {}: {error}", payload.file_name))?;

    fs::write(&asset_path, asset_bytes)
        .map_err(|error| format!("Failed to write asset file {}: {error}", asset_path.display()))?;

    let relative_asset_path = asset_path
        .strip_prefix(Path::new(&layout.root_path))
        .map_err(|error| format!("Failed to derive asset path inside the knowledge base: {error}"))?
        .to_string_lossy()
        .replace('\\', "/");
    let markdown_relative_path = relative_path_from(note_directory, &asset_path)
        .to_string_lossy()
        .replace('\\', "/");
    let markdown_snippet = if payload.kind.trim().eq_ignore_ascii_case("image") {
        format!("![{}]({markdown_relative_path})", payload.file_name)
    } else {
        format!("[{}]({markdown_relative_path})", payload.file_name)
    };

    Ok(ImportAssetResponse {
        relative_asset_path: relative_asset_path.clone(),
        markdown_snippet,
        message: format!("Imported {} into {}.", payload.file_name, relative_asset_path),
    })
}

#[tauri::command]
fn inspect_note_connections(
    root_path: String,
    note_id: String,
) -> Result<NoteConnectionsResponse, String> {
    let parsed_notes = load_parsed_notes(&root_path)?;
    let selected_note = parsed_notes
        .iter()
        .find(|note| note.summary.id == note_id)
        .cloned()
        .ok_or_else(|| format!("Failed to find note {} in the local knowledge base.", note_id))?;

    let mut note_index = HashMap::<String, NoteLinkReference>::new();
    for note in &parsed_notes {
        let reference = NoteLinkReference {
            title: note.summary.title.clone(),
            note_id: note.summary.id.clone(),
            relative_path: note.summary.relative_path.clone(),
        };

        for key in note_reference_keys(&note.summary) {
            note_index.insert(key, reference.clone());
        }
    }

    let mut outgoing_links = Vec::new();
    let mut unresolved_links = Vec::new();
    let mut seen_outgoing = HashMap::<String, bool>::new();

    for raw_link in extract_wikilinks(&selected_note.body) {
        let canonical = canonicalize_link_target(&raw_link);
        if canonical.is_empty() {
            continue;
        }

        if let Some(reference) = note_index.get(&canonical) {
            if seen_outgoing.insert(reference.note_id.clone(), true).is_none() {
                outgoing_links.push(reference.clone());
            }
        } else if seen_outgoing.insert(format!("unresolved:{canonical}"), true).is_none() {
            unresolved_links.push(raw_link);
        }
    }

    let selected_keys = note_reference_keys(&selected_note.summary);
    let mut backlinks = Vec::new();
    let mut seen_backlinks = HashMap::<String, bool>::new();

    for note in parsed_notes.iter().filter(|note| note.summary.id != selected_note.summary.id) {
        let links = extract_wikilinks(&note.body);
        let points_to_selected = links.iter().any(|raw_link| {
            let canonical = canonicalize_link_target(raw_link);
            selected_keys.iter().any(|key| key == &canonical)
        });

        if points_to_selected && seen_backlinks.insert(note.summary.id.clone(), true).is_none() {
            backlinks.push(NoteLinkReference {
                title: note.summary.title.clone(),
                note_id: note.summary.id.clone(),
                relative_path: note.summary.relative_path.clone(),
            });
        }
    }

    outgoing_links.sort_by(|left, right| left.title.cmp(&right.title));
    backlinks.sort_by(|left, right| left.title.cmp(&right.title));
    unresolved_links.sort();

    Ok(NoteConnectionsResponse {
        message: format!(
            "Found {} outgoing links, {} backlinks, and {} unresolved wikilinks.",
            outgoing_links.len(),
            backlinks.len(),
            unresolved_links.len()
        ),
        outgoing_links,
        backlinks,
        unresolved_links,
    })
}

#[tauri::command]
fn open_local_path(path: String) -> Result<OpenPathResponse, String> {
    let target_path = PathBuf::from(&path);
    if !target_path.exists() {
        return Err(format!("The local path does not exist: {}", target_path.display()));
    }

    let status = Command::new("open")
        .arg(&target_path)
        .status()
        .map_err(|error| format!("Failed to open {}: {error}", target_path.display()))?;
    if !status.success() {
        return Err(format!("macOS could not open {}.", target_path.display()));
    }

    Ok(OpenPathResponse {
        path: target_path.to_string_lossy().to_string(),
        message: format!("Opened {}.", target_path.display()),
    })
}

#[tauri::command]
fn reveal_local_path(path: String) -> Result<OpenPathResponse, String> {
    let target_path = PathBuf::from(&path);
    if !target_path.exists() {
        return Err(format!("The local path does not exist: {}", target_path.display()));
    }

    let status = Command::new("open")
        .args(["-R"])
        .arg(&target_path)
        .status()
        .map_err(|error| format!("Failed to reveal {}: {error}", target_path.display()))?;
    if !status.success() {
        return Err(format!("macOS could not reveal {} in Finder.", target_path.display()));
    }

    Ok(OpenPathResponse {
        path: target_path.to_string_lossy().to_string(),
        message: format!("Revealed {} in Finder.", target_path.display()),
    })
}

#[tauri::command]
fn prepare_sync(local_root_path: String, config: SyncConfigPayload) -> Result<SyncStatusResponse, String> {
    ensure_library_layout(&local_root_path)?;

    let connection = match connect_remote_library(&config) {
        Ok(connection) => connection,
        Err(error) => return Ok(sync_status_from_error(&config, error)),
    };

    let local_snapshot = build_library_snapshot(&local_root_path)?;
    let remote_snapshot = build_library_snapshot(&connection.remote_root_path)?;
    let snapshots_are_equal = snapshots_match(&local_snapshot, &remote_snapshot);
    let manifest = load_sync_manifest(&local_root_path)?;
    let profile_key = sync_profile_key(&config, &connection.remote_root_path);
    let has_manifest = manifest.profiles.contains_key(&profile_key);
    let requires_initial_decision = !has_manifest
        && local_snapshot.has_content
        && remote_snapshot.has_content
        && !snapshots_are_equal;
    let suggested_direction = if snapshots_are_equal {
        "none".to_string()
    } else {
        suggested_sync_direction(&local_snapshot, &remote_snapshot)
    };

    if has_manifest && !requires_initial_decision {
        return build_sync_status_response(
            &local_root_path,
            &config,
            &connection,
            None,
            None,
            0,
            0,
        );
    }

    let message = if snapshots_are_equal {
        "Local offline library and remote sync target already look aligned.".to_string()
    } else if requires_initial_decision {
        "Local offline library and remote sync target both contain content. Choose whether to pull the remote library down or push the local library up.".to_string()
    } else if suggested_direction == "pull_remote_to_local" {
        "Remote sync target contains content that can be pulled into the local offline library.".to_string()
    } else {
        "Local offline library is ready to push into the remote sync target.".to_string()
    };

    Ok(SyncStatusResponse {
        status: if requires_initial_decision {
            "decision_required".to_string()
        } else {
            "connected".to_string()
        },
        configured: true,
        reachable: true,
        mount_point: connection.mount_point,
        remote_root_path: connection.remote_root_path,
        webdav_url: config.webdav_url(),
        message: format!("{} {}", config.profile_name, message),
        requires_initial_decision,
        suggested_direction,
        local_snapshot: Some(local_snapshot),
        remote_snapshot: Some(remote_snapshot),
        copied_count: 0,
        skipped_count: 0,
        conflict_count: 0,
        conflicts: Vec::new(),
    })
}

#[tauri::command]
fn sync_libraries(payload: SyncLibrariesPayload) -> Result<SyncStatusResponse, String> {
    ensure_library_layout(&payload.local_root_path)?;
    let connection = match connect_remote_library(&payload.config) {
        Ok(connection) => connection,
        Err(error) => return Ok(sync_status_from_error(&payload.config, error)),
    };

    let (source_root, destination_root, message_prefix) = match payload.direction.as_str() {
        "pull_remote_to_local" => (
            connection.remote_root_path.as_str(),
            payload.local_root_path.as_str(),
            "Pulled remote changes into the local offline library.",
        ),
        "push_local_to_remote" => (
            payload.local_root_path.as_str(),
            connection.remote_root_path.as_str(),
            "Pushed local offline changes into the remote sync target.",
        ),
        other => {
            return Err(format!(
                "Unknown sync direction {other}. Expected push_local_to_remote or pull_remote_to_local."
            ))
        }
    };

    let execution = sync_library_contents(
        &payload.local_root_path,
        source_root,
        destination_root,
        &payload.config,
        &payload.direction,
        payload.allow_initial_override,
    )?;

    build_sync_status_response(
        &payload.local_root_path,
        &payload.config,
        &connection,
        None,
        Some(format!(
            "{} {message_prefix} This sync copied {} files, skipped {} unchanged files, and still does not delete extra destination files automatically.",
            payload.config.profile_name, execution.copied_count, execution.skipped_count
        )),
        execution.copied_count,
        execution.skipped_count,
    )
}

#[tauri::command]
fn resolve_sync_conflict(payload: ResolveSyncConflictPayload) -> Result<SyncStatusResponse, String> {
    ensure_library_layout(&payload.local_root_path)?;
    let connection = match connect_remote_library(&payload.config) {
        Ok(connection) => connection,
        Err(error) => return Ok(sync_status_from_error(&payload.config, error)),
    };
    let local_inventory = build_file_inventory(&payload.local_root_path)?;
    let remote_inventory = build_file_inventory(&connection.remote_root_path)?;
    let timestamp_ms = current_timestamp_ms()?;
    let profile_key = sync_profile_key(&payload.config, &connection.remote_root_path);
    let mut manifest = load_sync_manifest(&payload.local_root_path)?;
    let profile_manifest = manifest
        .profiles
        .entry(profile_key)
        .or_insert_with(|| SyncProfileManifest {
            last_direction: "push_local_to_remote".to_string(),
            updated_at_ms: 0,
            entries: HashMap::new(),
        });

    let (source_inventory, destination_root, direction) = match payload.resolution.as_str() {
        "keep_local" => (
            &local_inventory,
            connection.remote_root_path.as_str(),
            "push_local_to_remote",
        ),
        "keep_remote" => (
            &remote_inventory,
            payload.local_root_path.as_str(),
            "pull_remote_to_local",
        ),
        other => {
            return Err(format!(
                "Unknown conflict resolution {other}. Expected keep_local or keep_remote."
            ))
        }
    };

    let source_entry = source_inventory.get(&payload.relative_path).ok_or_else(|| {
        format!(
            "Conflict source file {} is not available for resolution.",
            payload.relative_path
        )
    })?;
    let destination_path = Path::new(destination_root).join(&payload.relative_path);
    copy_file(&source_entry.absolute_path, &destination_path)?;
    upsert_manifest_entry(
        profile_manifest,
        payload.relative_path.clone(),
        source_entry,
        timestamp_ms,
        direction,
    );
    save_sync_manifest(&payload.local_root_path, &manifest)?;

    build_sync_status_response(
        &payload.local_root_path,
        &payload.config,
        &connection,
        None,
        Some(format!(
            "{} resolved conflict for {} by choosing {}.",
            payload.config.profile_name, payload.relative_path, payload.resolution
        )),
        1,
        0,
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_default_local_library,
            inspect_library,
            load_library_index,
            create_note,
            load_note_document,
            save_note_document,
            import_asset,
            inspect_note_connections,
            open_local_path,
            reveal_local_path,
            prepare_sync,
            sync_libraries,
            resolve_sync_conflict
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

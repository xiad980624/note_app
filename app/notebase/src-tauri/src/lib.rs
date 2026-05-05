use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NasProfilePayload {
    profile_name: String,
    protocol: String,
    public_host: String,
    public_port: String,
    username: String,
    password: String,
    remote_path: String,
    library_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MountStatusResponse {
    status: String,
    mounted: bool,
    mount_point: String,
    resolved_storage_path: String,
    webdav_url: String,
    message: String,
    profile_name: String,
}

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteDocumentResponse {
    note: NoteSummary,
    raw_content: String,
    frontmatter: Option<String>,
    body: String,
    message: String,
}

impl NasProfilePayload {
    fn normalized_library_path(&self) -> String {
        self.library_path.trim_matches('/').to_string()
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

    fn normalized_protocol(&self) -> String {
        let trimmed = self.protocol.trim().to_ascii_lowercase();
        if trimmed == "https" {
            "https".to_string()
        } else {
            "http".to_string()
        }
    }

    fn mount_point(&self) -> String {
        self.fallback_mount_point()
            .unwrap_or_else(|| "/Volumes/WebDAV".to_string())
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

    fn fallback_mount_point(&self) -> Option<String> {
        self.remote_collection_name()
            .map(|collection| format!("/Volumes/{collection}"))
    }

    fn resolved_storage_path(&self) -> String {
        self.resolved_storage_path_for_mount_point(&self.mount_point())
    }

    fn resolved_storage_path_for_mount_point(&self, mount_point: &str) -> String {
        let library_path = self.normalized_library_path();
        if library_path.is_empty() {
            mount_point.to_string()
        } else {
            format!("{mount_point}/{library_path}")
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

        format!("{protocol}://{credentials}{host}{port_segment}{remote_path}")
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

fn build_status_response(
    profile: &NasProfilePayload,
    status: &str,
    mounted: bool,
    mount_point: String,
    resolved_storage_path: String,
    message: impl Into<String>,
) -> MountStatusResponse {
    MountStatusResponse {
        status: status.to_string(),
        mounted,
        mount_point,
        resolved_storage_path,
        webdav_url: profile.webdav_url(),
        message: message.into(),
        profile_name: profile.profile_name.clone(),
    }
}

fn probe_webdav_endpoint(profile: &NasProfilePayload) -> Option<String> {
    let credentials = if profile.username.trim().is_empty() {
        None
    } else {
        Some(format!("{}:{}", profile.username.trim(), profile.password))
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

    let output = command.arg(profile.webdav_url()).output().ok()?;

    if !output.status.success() {
        return None;
    }

    let headers = String::from_utf8_lossy(&output.stdout);
    if headers.contains("Dav:") || headers.contains("DAV:") {
        Some("Remote WebDAV endpoint is reachable, but the local macOS volume is not mounted yet.".to_string())
    } else {
        None
    }
}

fn resolve_available_mount_point(profile: &NasProfilePayload) -> Option<(String, bool)> {
    let expected = profile.mount_point();
    if Path::new(&expected).exists() {
        return Some((expected, false));
    }

    let fallback = profile.fallback_mount_point()?;
    if Path::new(&fallback).exists() {
        return Some((fallback, true));
    }

    None
}

fn ensure_knowledge_base_layout_for_mount_point(
    profile: &NasProfilePayload,
    mount_point: &str,
) -> Result<KnowledgeBaseIndexResponse, String> {
    let root_path = profile.resolved_storage_path_for_mount_point(mount_point);
    let notes_root = format!("{}/notes", root_path);
    let assets_root = format!("{}/assets", root_path);
    let hidden_root = format!("{}/.notebase", root_path);

    let directories = [
        root_path.clone(),
        notes_root.clone(),
        format!("{notes_root}/inbox"),
        format!("{notes_root}/projects"),
        format!("{notes_root}/topics"),
        assets_root.clone(),
        format!("{assets_root}/images"),
        format!("{assets_root}/files"),
        hidden_root.clone(),
    ];

    let initialized_new_knowledge_base = match fs::read_dir(&root_path) {
        Ok(mut entries) => entries.next().is_none(),
        Err(_) => true,
    };

    for directory in directories {
        fs::create_dir_all(&directory)
            .map_err(|error| format!("Failed to create knowledge base directory {directory}: {error}"))?;
    }

    Ok(KnowledgeBaseIndexResponse {
        root_path,
        notes_root,
        assets_root,
        hidden_root,
        initialized_new_knowledge_base,
        notes: Vec::new(),
        message: if initialized_new_knowledge_base {
            "A new knowledge base layout was created in this folder.".to_string()
        } else {
            "Knowledge base layout is ready.".to_string()
        },
    })
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

fn resolve_note_path(
    notes_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.is_absolute() {
        return Err("Note path must be relative to the notes root.".to_string());
    }

    let resolved = notes_root.join(relative);
    Ok(resolved)
}

#[tauri::command]
fn create_note(profile: NasProfilePayload) -> Result<CreateNoteResponse, String> {
    let mount_point = resolve_available_mount_point(&profile)
        .map(|(mount_point, _)| mount_point)
        .unwrap_or_else(|| profile.mount_point());
    let layout = ensure_knowledge_base_layout_for_mount_point(&profile, &mount_point)?;
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
fn load_note_document(
    profile: NasProfilePayload,
    note_id: String,
) -> Result<NoteDocumentResponse, String> {
    let mount_point = resolve_available_mount_point(&profile)
        .map(|(mount_point, _)| mount_point)
        .unwrap_or_else(|| profile.mount_point());
    let layout = ensure_knowledge_base_layout_for_mount_point(&profile, &mount_point)?;
    let notes_root = Path::new(&layout.notes_root);
    let note_path = resolve_note_path(notes_root, &note_id)?;
    let raw_content = fs::read_to_string(&note_path)
        .map_err(|error| format!("Failed to read note file {}: {error}", note_path.display()))?;
    let (frontmatter, body) = parse_frontmatter_block(&raw_content);
    let note = parse_note_summary(&note_path, notes_root)?;
    let raw_content_owned = raw_content.clone();
    let loaded_relative_path = note.relative_path.clone();

    Ok(NoteDocumentResponse {
        note,
        raw_content: raw_content_owned,
        frontmatter: frontmatter.map(ToString::to_string),
        body: body.to_string(),
        message: format!("Loaded note content from {}.", loaded_relative_path),
    })
}

#[tauri::command]
fn load_knowledge_base_index(profile: NasProfilePayload) -> Result<KnowledgeBaseIndexResponse, String> {
    let mount_point = resolve_available_mount_point(&profile)
        .map(|(mount_point, _)| mount_point)
        .unwrap_or_else(|| profile.mount_point());
    let mut layout = ensure_knowledge_base_layout_for_mount_point(&profile, &mount_point)?;
    let notes_root_path = Path::new(&layout.notes_root);
    let mut markdown_files = Vec::new();

    collect_markdown_files(notes_root_path, &mut markdown_files)?;

    let mut notes = markdown_files
        .iter()
        .map(|path| parse_note_summary(path, notes_root_path))
        .collect::<Result<Vec<_>, _>>()?;

    notes.sort_by(|left, right| right.updated_at_ms.cmp(&left.updated_at_ms));

    let note_count = notes.len();
    layout.notes = notes;
    layout.message = format!(
        "{} {} markdown notes were indexed.",
        if layout.initialized_new_knowledge_base {
            "A new knowledge base layout was created and"
        } else {
            "Knowledge base layout is ready and"
        },
        note_count
    );

    Ok(layout)
}

#[tauri::command]
fn inspect_knowledge_base(profile: NasProfilePayload) -> Result<LibraryOverviewResponse, String> {
    let mount_point = resolve_available_mount_point(&profile)
        .map(|(mount_point, _)| mount_point)
        .unwrap_or_else(|| profile.mount_point());
    let resolved_storage_path = profile.resolved_storage_path_for_mount_point(&mount_point);
    let path = Path::new(&resolved_storage_path);

    if !path.exists() {
        return Ok(LibraryOverviewResponse {
            resolved_storage_path,
            exists: false,
            readable: false,
            directory_count: 0,
            file_count: 0,
            sample_entries: Vec::new(),
            message: "Knowledge base directory does not exist yet.".to_string(),
        });
    }

    let entries = fs::read_dir(path).map_err(|error| {
        format!(
            "Failed to read knowledge base directory {}: {error}",
            resolved_storage_path
        )
    })?;

    let mut directory_count = 0;
    let mut file_count = 0;
    let mut sample_entries = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "Failed while iterating knowledge base directory {}: {error}",
                resolved_storage_path
            )
        })?;

        let entry_type = entry.file_type().map_err(|error| {
            format!(
                "Failed to inspect an entry in knowledge base directory {}: {error}",
                resolved_storage_path
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
        resolved_storage_path: resolved_storage_path.clone(),
        exists: true,
        readable: true,
        directory_count,
        file_count,
        sample_entries,
        message: format!(
            "Knowledge base directory is readable at {}.",
            resolved_storage_path
        ),
    })
}

#[tauri::command]
fn check_mount_status(profile: NasProfilePayload) -> Result<MountStatusResponse, String> {
    let expected_mount_point = profile.mount_point();
    let mount_resolution = resolve_available_mount_point(&profile);
    let mount_point = mount_resolution
        .as_ref()
        .map(|(mount_point, _)| mount_point.clone())
        .unwrap_or_else(|| expected_mount_point.clone());
    let resolved_storage_path = profile.resolved_storage_path_for_mount_point(&mount_point);
    let mount_exists = Path::new(&mount_point).exists();
    let resolved_exists = Path::new(&resolved_storage_path).exists();

    if resolved_exists {
        Ok(build_status_response(
            &profile,
            "mounted",
            true,
            mount_point.clone(),
            resolved_storage_path.clone(),
            if let Some((_, used_fallback)) = mount_resolution {
                if used_fallback {
                    format!(
                        "Knowledge base is reachable at {resolved_storage_path}. macOS mounted the volume as {mount_point}, based on the last segment of the WebDAV path."
                    )
                } else {
                    format!("Knowledge base is reachable at {resolved_storage_path}.")
                }
            } else {
                format!("Knowledge base is reachable at {resolved_storage_path}.")
            },
        ))
    } else if mount_exists {
        let created_layout = ensure_knowledge_base_layout_for_mount_point(&profile, &mount_point)?;
        Ok(build_status_response(
            &profile,
            "mounted",
            true,
            mount_point.clone(),
            resolved_storage_path.clone(),
            format!(
                "Mounted volume exists at {mount_point}. NoteBase created the missing knowledge base layout at {}.",
                created_layout.root_path
            ),
        ))
    } else {
        let probe_message = probe_webdav_endpoint(&profile);
        Ok(build_status_response(
            &profile,
            "failed",
            false,
            expected_mount_point.clone(),
            profile.resolved_storage_path(),
            probe_message.unwrap_or_else(|| {
                format!(
                    "Mounted volume is not available. Expected mount point: {expected_mount_point}. Remote WebDAV endpoint did not confirm as reachable from the local app check."
                )
            }),
        ))
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn attempt_webdav_mount(profile: NasProfilePayload) -> Result<MountStatusResponse, String> {
    let webdav_url = profile.webdav_url();
    let script = format!(
        "try
set mountedAlias to mount volume \"{webdav_url}\"
return POSIX path of mountedAlias
on error errMsg number errNum
return \"ERROR \" & errNum & \": \" & errMsg
end try"
    );
    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("Failed to launch macOS mount volume: {error}"))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stdout.starts_with("ERROR ") {
            Ok(build_status_response(
                &profile,
                "failed",
                false,
                profile.mount_point(),
                profile.resolved_storage_path(),
                format!("Automatic mount attempt failed: {stdout}"),
            ))
        } else {
            let actual_mount_point = stdout.trim_end_matches('/').to_string();
            let resolved_storage_path =
                profile.resolved_storage_path_for_mount_point(&actual_mount_point);

            if Path::new(&resolved_storage_path).exists() {
                Ok(build_status_response(
                    &profile,
                    "mounted",
                    true,
                    actual_mount_point.clone(),
                    resolved_storage_path.clone(),
                    format!(
                        "Mounted successfully through macOS system mount. The actual mounted volume is {actual_mount_point}."
                    ),
                ))
            } else {
                let created_layout =
                    ensure_knowledge_base_layout_for_mount_point(&profile, &actual_mount_point)?;
                Ok(build_status_response(
                    &profile,
                    "mounted",
                    true,
                    actual_mount_point.clone(),
                    resolved_storage_path.clone(),
                    format!(
                        "macOS mounted the WebDAV volume at {actual_mount_point}. NoteBase created the missing knowledge base layout at {}.",
                        created_layout.root_path
                    ),
                ))
            }
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "mount_webdav returned a non-zero exit status.".to_string()
        };

        Ok(build_status_response(
            &profile,
            "failed",
            false,
            profile.mount_point(),
            profile.resolved_storage_path(),
            format!("Automatic mount attempt failed: {detail}"),
        ))
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn attempt_webdav_mount(profile: NasProfilePayload) -> Result<MountStatusResponse, String> {
    Ok(build_status_response(
        &profile,
        "failed",
        false,
        profile.mount_point(),
        profile.resolved_storage_path(),
        "Automatic WebDAV mounting is currently implemented for macOS only.",
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            create_note,
            load_note_document,
            load_knowledge_base_index,
            inspect_knowledge_base,
            check_mount_status,
            attempt_webdav_mount
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

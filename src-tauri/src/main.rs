#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Cursor;
use std::path::PathBuf;
use std::process::Command;
use zip::ZipArchive;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn silent_cmd(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

fn silent_cmd_path(program: &std::path::Path) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

fn command_exists(name: &str) -> bool {
    if let Ok(o) = silent_cmd("where").arg(name).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).output() {
        o.status.success()
    } else {
        false
    }
}

fn find_python() -> Option<String> {
    let embedded = python_dir().join("python.exe");
    if embedded.exists() {
        return Some(embedded.to_string_lossy().to_string());
    }
    for c in &["py", "python", "python3"] {
        if command_exists(c) {
            if let Ok(o) = silent_cmd(c).arg("--version").stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).output() {
                let out = String::from_utf8_lossy(&o.stdout);
                let err = String::from_utf8_lossy(&o.stderr);
                if o.status.success() && (out.contains("Python") || err.contains("Python")) {
                    return Some(c.to_string());
                }
            }
        }
    }
    None
}

fn app_data_dir() -> PathBuf {
    dirs::data_local_dir().unwrap_or_else(|| PathBuf::from(".")).join("ascii-art-generator")
}

fn python_dir() -> PathBuf { app_data_dir().join("python") }
fn go_dir() -> PathBuf { app_data_dir().join("go") }
fn img2braille_dir() -> PathBuf { app_data_dir().join("img2braille") }
fn img2braille_local_dir() -> PathBuf { app_data_dir().join("img2braille-local") }
fn tools_dir() -> PathBuf { app_data_dir().join("bin") }

const IMG2BRAILLE_LOCAL_SCRIPT: &str = include_str!("img2braille_local.py");

fn resolve_python() -> Result<std::path::PathBuf, String> {
    let py_exe = python_dir().join("python.exe");
    if py_exe.exists() { return Ok(py_exe); }
    if let Some(py) = find_python() { return Ok(std::path::PathBuf::from(py)); }
    Err("Python no encontrado".to_string())
}

fn extract_zip(bytes: &[u8], dest: &std::path::Path) -> Result<(), String> {
    let reader = Cursor::new(bytes);
    let mut archive = ZipArchive::new(reader).map_err(|e| format!("Error abriendo ZIP: {}", e))?;
    archive.extract(dest).map_err(|e| format!("Error extrayendo ZIP: {}", e))?;
    Ok(())
}

// ===== CHECK / INSTALL =====

#[tauri::command]
fn check_tool(name: &str) -> bool {
    match name {
        "pip" => {
            let py_exe = python_dir().join("python.exe");
            if py_exe.exists() {
                if let Ok(o) = silent_cmd_path(&py_exe).args(["-m", "pip", "--version"]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).output() {
                    if o.status.success() { return true; }
                }
            }
            if let Some(py) = find_python() {
                if let Ok(o) = silent_cmd(&py).args(["-m", "pip", "--version"]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).output() {
                    if o.status.success() { return true; }
                }
            }
            false
        }
        "go" => {
            if command_exists("go") { return true; }
            go_dir().join("bin").join("go.exe").exists()
        }
        "artty" => {
            if let Ok(py) = resolve_python() {
                if let Ok(o) = silent_cmd_path(&py).args(["-c", "import artty"]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).output() {
                    return o.status.success();
                }
            }
            false
        }
        "img2braille" => img2braille_dir().join("script.py").exists(),
        "img2braille_local" => img2braille_local_dir().join("script.py").exists(),
        "jp2b" => tools_dir().join("jp2b.exe").exists() || go_dir().join("bin").join("jp2b.exe").exists() || command_exists("jp2b"),
        _ => command_exists(name),
    }
}

#[tauri::command]
async fn install_python() -> Result<String, String> {
    let dir = python_dir();
    if dir.join("python.exe").exists() {
        return Ok("Python ya esta instalado".to_string());
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("Error creando directorio: {}", e))?;

    let url = "https://www.python.org/ftp/python/3.12.7/python-3.12.7-embed-amd64.zip";
    let bytes = reqwest::get(url).await
        .map_err(|e| format!("Error descargando Python: {}", e))?
        .bytes().await
        .map_err(|e| format!("Error leyendo datos: {}", e))?;
    extract_zip(&bytes, &dir)?;

    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            let name = p.file_name().unwrap_or_default().to_string_lossy();
            if name.contains("._pth") {
                if let Ok(content) = std::fs::read_to_string(&p) {
                    std::fs::write(&p, content.replace("#import site", "import site")).ok();
                }
            }
        }
    }

    let get_pip_bytes = reqwest::get("https://bootstrap.pypa.io/get-pip.py").await
        .map_err(|e| format!("Error descargando get-pip.py: {}", e))?
        .bytes().await
        .map_err(|e| format!("Error leyendo get-pip.py: {}", e))?;
    let get_pip_path = dir.join("get-pip.py");
    std::fs::write(&get_pip_path, &*get_pip_bytes).map_err(|e| format!("Error guardando: {}", e))?;

    let py_exe = dir.join("python.exe");
    let gp = get_pip_path.clone();
    let output = tokio::task::spawn_blocking(move || silent_cmd_path(&py_exe).arg(&gp).output())
        .await.unwrap_or_else(|_| Err(std::io::Error::new(std::io::ErrorKind::Other, "fail")))
        .map_err(|e| format!("Error ejecutando get-pip.py: {}", e))?;
    std::fs::remove_file(&get_pip_path).ok();

    if !output.status.success() {
        return Err(format!("Error instalando pip: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok("Python + pip instalado correctamente".to_string())
}

#[tauri::command]
async fn install_go() -> Result<String, String> {
    let dir = go_dir();
    if dir.join("bin").join("go.exe").exists() {
        return Ok("Go ya esta instalado".to_string());
    }
    // jp2b v1.0.1 requires Go 1.24.1 or newer.
    let url = "https://go.dev/dl/go1.24.1.windows-amd64.zip";
    let bytes = reqwest::get(url).await
        .map_err(|e| format!("Error descargando Go: {}", e))?
        .bytes().await
        .map_err(|e| format!("Error leyendo datos: {}", e))?;
    let parent = dir.parent().unwrap_or(&dir);
    extract_zip(&bytes, parent)?;
    if go_dir().join("bin").join("go.exe").exists() {
        Ok("Go instalado correctamente".to_string())
    } else {
        Ok("Go extraido".to_string())
    }
}

#[tauri::command]
async fn install_tool(name: String) -> Result<String, String> {
    let py_exe = resolve_python()?;
    let tool_name = name.clone();
    let output = tokio::task::spawn_blocking(move || {
        silent_cmd_path(&py_exe).args(["-m", "pip", "install", &tool_name]).output()
    }).await.unwrap_or_else(|_| Err(std::io::Error::new(std::io::ErrorKind::Other, "fail")))
      .map_err(|e| format!("No se pudo ejecutar pip: {}", e))?;
    if output.status.success() {
        Ok(format!("{} instalado correctamente", name))
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
async fn install_img2braille() -> Result<String, String> {
    let dir = img2braille_dir();
    let script = dir.join("script.py");
    if !script.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("Error creando directorio: {}", e))?;
        let bytes = reqwest::get("https://github.com/TheFel0x/img2braille/archive/refs/heads/main.zip").await
            .map_err(|e| format!("Error descargando img2braille: {}", e))?
            .bytes().await
            .map_err(|e| format!("Error leyendo img2braille: {}", e))?;
        extract_zip(&bytes, &dir)?;
        let extracted = dir.join("img2braille-main");
        if extracted.join("script.py").exists() {
            for entry in std::fs::read_dir(&extracted).map_err(|e| e.to_string())?.flatten() {
                let destination = dir.join(entry.file_name());
                std::fs::rename(entry.path(), destination).map_err(|e| e.to_string())?;
            }
            std::fs::remove_dir(&extracted).ok();
        }
    }

    let py_exe = resolve_python()?;
    let requirements = dir.join("requirements.txt");
    let output = tokio::task::spawn_blocking(move || {
        silent_cmd_path(&py_exe).args(["-m", "pip", "install", "-r", &requirements.to_string_lossy()]).output()
    }).await.unwrap_or_else(|_| Err(std::io::Error::new(std::io::ErrorKind::Other, "fail")))
      .map_err(|e| format!("No se pudo ejecutar pip: {}", e))?;
    if output.status.success() {
        Ok("img2braille instalado desde TheFel0x/img2braille".to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
async fn install_img2braille_local() -> Result<String, String> {
    let dir = img2braille_local_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Error creando directorio: {}", e))?;
    std::fs::write(dir.join("script.py"), IMG2BRAILLE_LOCAL_SCRIPT)
        .map_err(|e| format!("Error guardando el motor local: {}", e))?;

    let py_exe = resolve_python()?;
    let output = tokio::task::spawn_blocking(move || {
        silent_cmd_path(&py_exe).args(["-m", "pip", "install", "Pillow"]).output()
    }).await.unwrap_or_else(|_| Err(std::io::Error::new(std::io::ErrorKind::Other, "fail")))
      .map_err(|e| format!("No se pudo ejecutar pip: {}", e))?;
    if output.status.success() {
        Ok("img2braille (Local) instalado con soporte de alto".to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
async fn install_jp2b() -> Result<String, String> {
    let go_exe = if go_dir().join("bin").join("go.exe").exists() {
        go_dir().join("bin").join("go.exe")
    } else if command_exists("go") {
        PathBuf::from("go")
    } else {
        return Err("Go no encontrado".to_string());
    };
    let bin_dir = tools_dir();
    std::fs::create_dir_all(&bin_dir).map_err(|e| format!("Error creando directorio: {}", e))?;
    let output = tokio::task::spawn_blocking(move || {
        let mut command = silent_cmd_path(&go_exe);
        // The module root is a library; the executable is in cmd/jp2b.
        command.env("GOBIN", &bin_dir).args(["install", "github.com/theZMC/jp2b/cmd/jp2b@latest"]).output()
    }).await.unwrap_or_else(|_| Err(std::io::Error::new(std::io::ErrorKind::Other, "fail")))
      .map_err(|e| format!("No se pudo ejecutar Go: {}", e))?;
    if output.status.success() {
        Ok("jp2b instalado desde github.com/theZMC/jp2b".to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
async fn uninstall_tool(name: String) -> Result<String, String> {
    let py_exe = resolve_python()?;
    let tool_name = name.clone();
    let output = tokio::task::spawn_blocking(move || {
        silent_cmd_path(&py_exe).args(["-m", "pip", "uninstall", "-y", &tool_name]).output()
    }).await.unwrap_or_else(|_| Err(std::io::Error::new(std::io::ErrorKind::Other, "fail")))
      .map_err(|e| format!("No se pudo ejecutar pip: {}", e))?;
    if output.status.success() {
        Ok(format!("{} desinstalado correctamente", name))
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn uninstall_img2braille() -> Result<String, String> {
    let dir = img2braille_dir();
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("Error desinstalando img2braille: {}", e))?;
    }
    Ok("img2braille desinstalado".to_string())
}

#[tauri::command]
fn uninstall_img2braille_local() -> Result<String, String> {
    let dir = img2braille_local_dir();
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("Error desinstalando img2braille (Local): {}", e))?;
    }
    Ok("img2braille (Local) desinstalado".to_string())
}

#[tauri::command]
fn uninstall_jp2b() -> Result<String, String> {
    let binary = tools_dir().join("jp2b.exe");
    if binary.exists() {
        std::fs::remove_file(&binary).map_err(|e| format!("Error desinstalando jp2b: {}", e))?;
    }
    Ok("jp2b desinstalado".to_string())
}

// ===== ARTTY CONVERSION =====

#[tauri::command]
async fn save_temp_image(name: String, data: Vec<u8>) -> Result<String, String> {
    let dir = std::env::temp_dir().join("ascii-art-generator");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&name);
    std::fs::write(&path, &data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn convert_artty(
    image_path: String,
    width: u32,
    threshold: u32,
    color: bool,
    boost: f64,
) -> Result<String, String> {
    let py_exe = resolve_python()?;
    let color_str = if color { "True" } else { "False" };
    let script = format!(
        r#"import sys, io; sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8'); from artty import image_to_braille; print(image_to_braille(path=r"{}", width={}, threshold={}, contrast=1.0, sharpness=1.0, crop_padding=30, color={}, color_boost={}))"#,
        image_path.replace('\\', "\\\\"),
        width, threshold, color_str, boost
    );
    let py_exe_str = py_exe.to_string_lossy().to_string();
    let output = tokio::task::spawn_blocking(move || {
        Command::new(&py_exe_str)
            .args(["-c", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
    }).await.unwrap_or_else(|_| Err(std::io::Error::new(std::io::ErrorKind::Other, "fail")))
      .map_err(|e| format!("Error ejecutando artty: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

// ===== CLI CONVERSION =====

#[tauri::command]
async fn convert_img2braille(
    image_path: String,
    width: u32,
    dither: bool,
    invert: bool,
    autocontrast: bool,
    calc: String,
    noempty: bool,
) -> Result<String, String> {
    let script = img2braille_dir().join("script.py");
    if !script.exists() {
        return Err("img2braille no instalado".to_string());
    }
    let py_exe = resolve_python()?;
    let script_dir = img2braille_dir();
    if !matches!(calc.as_str(), "RGBsum" | "R" | "G" | "B" | "BW") {
        return Err("Modo de calculo no valido".to_string());
    }

    let output = tokio::task::spawn_blocking(move || {
        let mut command = silent_cmd_path(&py_exe);
        command
            .arg(&script)
            .arg(&image_path)
            .args(["-w", &width.to_string(), "-c", "none", "--calc", &calc])
            .current_dir(&script_dir)
            .env("PYTHONIOENCODING", "utf-8");
        if dither { command.arg("-d"); }
        if !invert { command.arg("-i"); }
        if autocontrast { command.arg("-a"); }
        if noempty { command.arg("-n"); }
        command.output()
    }).await.unwrap_or_else(|_| Err(std::io::Error::new(std::io::ErrorKind::Other, "fail")))
      .map_err(|e| format!("Error ejecutando img2braille: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
async fn convert_img2braille_local(
    image_path: String,
    width: u32,
    height: u32,
    mobile: bool,
    dither: bool,
    invert: bool,
    autocontrast: bool,
    calc: String,
    noempty: bool,
) -> Result<String, String> {
    let script = img2braille_local_dir().join("script.py");
    if !script.exists() {
        return Err("img2braille (Local) no instalado".to_string());
    }
    if !matches!(calc.as_str(), "RGBsum" | "R" | "G" | "B" | "BW") {
        return Err("Modo de calculo no valido".to_string());
    }
    let py_exe = resolve_python()?;
    let script_dir = img2braille_local_dir();
    let output = tokio::task::spawn_blocking(move || {
        let mut command = silent_cmd_path(&py_exe);
        command
            .arg(&script)
            .arg(&image_path)
            .args(["-w", &width.to_string(), "-H", &height.to_string(), "--calc", &calc])
            .current_dir(&script_dir)
            .env("PYTHONIOENCODING", "utf-8");
        if dither { command.arg("-d"); }
        if !invert { command.arg("-i"); }
        if autocontrast { command.arg("-a"); }
        if noempty { command.arg("-n"); }
        if mobile { command.arg("-m"); }
        command.output()
    }).await.unwrap_or_else(|_| Err(std::io::Error::new(std::io::ErrorKind::Other, "fail")))
      .map_err(|e| format!("Error ejecutando img2braille (Local): {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
async fn convert_jp2b(image_path: String) -> Result<String, String> {
    let jp2b_exe = if tools_dir().join("jp2b.exe").exists() {
        tools_dir().join("jp2b.exe")
    } else if go_dir().join("bin").join("jp2b.exe").exists() {
        go_dir().join("bin").join("jp2b.exe")
    } else {
        return Err("jp2b no encontrado".to_string());
    };
    let img = image_path.clone();
    let output = tokio::task::spawn_blocking(move || {
        silent_cmd_path(&jp2b_exe)
            .args(["-i", &img])
            .output()
    }).await.unwrap_or_else(|_| Err(std::io::Error::new(std::io::ErrorKind::Other, "fail")))
      .map_err(|e| format!("Error ejecutando jp2b: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| format!("No se pudo abrir: {}", e))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            check_tool, install_tool, uninstall_tool,
            uninstall_img2braille, uninstall_img2braille_local, uninstall_jp2b,
            install_python, install_go, install_img2braille, install_img2braille_local, install_jp2b,
            convert_artty, convert_img2braille, convert_img2braille_local, convert_jp2b,
            save_temp_image, open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

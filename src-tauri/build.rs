fn main() {
    println!("cargo:rerun-if-env-changed=CCL_MICROSOFT_CLIENT_ID");
    tauri_build::build()
}

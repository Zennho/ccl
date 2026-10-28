use crate::{http_client, ResultT};
use base64::{
    engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD},
    Engine,
};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Cursor,
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::Mutex,
};

const AUTHORIZE_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const TOKEN_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBOX_URL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_URL: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_URL: &str = "https://api.minecraftservices.com";
const SCOPE: &str = "XboxLive.signin offline_access";
const DEFAULT_CLIENT_ID: &str = "0f53017c-f10d-44c2-88fc-8c591f76275c";

#[derive(Clone)]
struct Pending {
    client_id: String,
    verifier: String,
    state_token: String,
    redirect_uri: String,
    authorization_url: String,
    listener: Arc<TcpListener>,
    expires: Instant,
    generation: u64,
}
#[derive(Clone)]
struct Session {
    client_id: String,
    refresh_token: Option<String>,
    access_token: String,
    expires: Instant,
    name: String,
    uuid: String,
    xuid: String,
    generation: u64,
}
#[derive(Default)]
struct AuthState {
    pending: Option<Pending>,
    session: Option<Session>,
    generation: u64,
}
static STATE: OnceLock<Mutex<AuthState>> = OnceLock::new();
static REFRESH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
fn state() -> &'static Mutex<AuthState> {
    STATE.get_or_init(|| Mutex::new(AuthState::default()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPrompt {
    opened: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    name: String,
    uuid: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapeInfo {
    id: String,
    name: String,
    active: bool,
    texture: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    skin: Option<String>,
    model: String,
    capes: Vec<CapeInfo>,
}
#[derive(Clone)]
pub struct LaunchIdentity {
    pub name: String,
    pub uuid: String,
    pub xuid: String,
    pub access_token: String,
}
fn info(s: &Session) -> AccountInfo {
    AccountInfo {
        name: s.name.clone(),
        uuid: s.uuid.clone(),
    }
}
fn valid_client_id(id: &str) -> bool {
    id.len() == 36
        && id.chars().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == '-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}
fn response_json_error(status: reqwest::StatusCode, body: &Value, context: &str) -> String {
    if status == reqwest::StatusCode::UNAUTHORIZED {
        format!("{context}：授权失效，请重新登录")
    } else if status == reqwest::StatusCode::FORBIDDEN {
        if context == "Minecraft 登录" {
            if body["errorMessage"].as_str().is_some_and(|message| {
                message
                    .to_ascii_lowercase()
                    .contains("invalid app registration")
            }) {
                return "Minecraft 登录：应用注册未获 Minecraft 服务许可，请联系启动器开发者申请授权。".into();
            }
            if body["details"]["reason"].as_str() == Some("ACCOUNT_SUSPENDED") {
                return "Minecraft 登录：账户被 Minecraft 服务暂停，请联系 Minecraft 支持。".into();
            }
        }
        match body["XErr"].as_u64() {
            Some(2148916233) => "Xbox 账户未创建，请先完成 Xbox 资料设置".into(),
            Some(2148916238) => "Xbox 家庭或年龄设置阻止登录，请检查账户设置".into(),
            _ => format!("{context}：服务拒绝访问，请检查账户和应用权限"),
        }
    } else {
        format!("{context}：服务返回 HTTP {status}")
    }
}
async fn json_response(response: reqwest::Response, context: &str) -> ResultT<Value> {
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|_| format!("{context}：返回数据无效"))?;
    if !status.is_success() {
        return Err(response_json_error(status, &body, context));
    }
    Ok(body)
}
fn request_error(context: &str) -> impl FnOnce(reqwest::Error) -> String + '_ {
    move |_| format!("{context}：连接失败，请检查网络或代理")
}

fn random_url_token() -> ResultT<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "无法生成安全登录参数")?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
fn authorization_url(
    client_id: &str,
    redirect_uri: &str,
    verifier: &str,
    state_token: &str,
) -> ResultT<String> {
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url = reqwest::Url::parse(AUTHORIZE_URL).map_err(|_| "微软登录地址无效")?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_mode", "query")
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state_token)
        .append_pair("prompt", "select_account");
    Ok(url.to_string())
}
pub(crate) fn open_browser(url: &str) -> ResultT<()> {
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("rundll32.exe");
        c.arg("url.dll,FileProtocolHandler");
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(url)
        .spawn()
        .map_err(|_| "无法打开浏览器，请检查系统默认浏览器")?;
    Ok(())
}
fn configured_client_id(value: Option<&str>) -> ResultT<String> {
    let id = value.unwrap_or("").trim();
    if !valid_client_id(id) {
        return Err("此版本尚未配置可用的微软登录应用，请联系启动器开发者。".into());
    }
    Ok(id.to_string())
}
#[tauri::command]
pub async fn begin_microsoft_login() -> ResultT<BrowserPrompt> {
    let client_id = configured_client_id(Some(
        option_env!("CCL_MICROSOFT_CLIENT_ID").unwrap_or(DEFAULT_CLIENT_ID),
    ))?;
    let generation = {
        let mut s = state().lock().await;
        s.generation += 1;
        s.pending = None;
        s.generation
    };
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|_| "无法启动本地登录回调，请检查系统网络设置")?;
    let port = listener
        .local_addr()
        .map_err(|_| "无法获取本地登录端口")?
        .port();
    let redirect_uri = format!("http://localhost:{port}/");
    let verifier = random_url_token()?;
    let state_token = random_url_token()?;
    let url = authorization_url(&client_id, &redirect_uri, &verifier, &state_token)?;
    let mut s = state().lock().await;
    if s.generation != generation {
        return Err("登录已取消".into());
    }
    s.pending = Some(Pending {
        client_id,
        verifier,
        state_token,
        redirect_uri,
        authorization_url: url.clone(),
        listener: Arc::new(listener),
        expires: Instant::now() + Duration::from_secs(600),
        generation,
    });
    drop(s);
    Ok(BrowserPrompt {
        opened: open_browser(&url).is_ok(),
    })
}
fn parse_callback(target: &str, expected_state: &str) -> ResultT<Option<String>> {
    let parsed =
        reqwest::Url::parse(&format!("http://localhost{target}")).map_err(|_| "登录回调无效")?;
    if parsed.path() != "/" {
        return Err("登录回调路径无效".into());
    }
    let mut code = None;
    let mut returned_state = None;
    let mut error = None;
    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "state" if returned_state.is_none() => returned_state = Some(value.into_owned()),
            "code" if code.is_none() => code = Some(value.into_owned()),
            "error" if error.is_none() => error = Some(value.into_owned()),
            "state" | "code" | "error" => return Err("登录回调参数重复".into()),
            _ => {}
        }
    }
    if returned_state.as_deref() != Some(expected_state) {
        return Err("登录回调状态不匹配".into());
    }
    if error.is_some() {
        return Ok(None);
    }
    let code = code
        .filter(|c| !c.is_empty() && c.len() <= 8192)
        .ok_or("登录回调缺少授权代码")?;
    Ok(Some(code))
}
async fn respond_callback(stream: &mut TcpStream, status: &str, message: &str) {
    let body=format!("<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>CCL 登录</title><style>body{{font:16px system-ui,sans-serif;color:#344332;background:#f4f1e8;display:grid;place-items:center;min-height:90vh;margin:0}}main{{background:#fffdf7;padding:36px;border:1px solid #dce5d5;border-radius:8px;max-width:480px}}h1{{font-size:21px}}p{{line-height:1.7;color:#677a61}}</style><main><h1>CCL 账户登录</h1><p>{message}</p></main><script>history.replaceState(null,'','/')</script></html>");
    let response=format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'\r\nConnection: close\r\n\r\n{body}",body.len());
    let _ = stream.write_all(response.as_bytes()).await;
}
async fn callback_request(
    mut stream: TcpStream,
    expected_state: &str,
) -> ResultT<Option<Option<String>>> {
    let result = tokio::time::timeout(Duration::from_secs(3), async {
        let mut request = Vec::new();
        let mut chunk = [0u8; 2048];
        loop {
            let n = stream
                .read(&mut chunk)
                .await
                .map_err(|_| "读取登录回调失败")?;
            if n == 0 {
                break;
            }
            request.extend_from_slice(&chunk[..n]);
            if request.len() > 16384 {
                return Err("登录回调过大");
            }
            if request.windows(4).any(|w| w == b"\r\n\r\n") {
                break;
            }
        }
        let line = request
            .split(|b| *b == b'\n')
            .next()
            .ok_or("登录回调无效")?;
        let line = std::str::from_utf8(line)
            .map_err(|_| "登录回调无效")?
            .trim_end();
        let mut parts = line.split_whitespace();
        let method = parts.next().unwrap_or("");
        let target = parts.next().unwrap_or("");
        if method != "GET" || !target.starts_with('/') || target.starts_with("//") {
            return Err("登录回调无效");
        }
        Ok::<String, &str>(target.to_string())
    })
    .await;
    let target = match result {
        Ok(Ok(target)) => target,
        _ => {
            respond_callback(
                &mut stream,
                "400 Bad Request",
                "登录回调无效，请返回启动器重试。",
            )
            .await;
            return Ok(None);
        }
    };
    match parse_callback(&target, expected_state) {
        Ok(code) => {
            respond_callback(
                &mut stream,
                "200 OK",
                if code.is_some() {
                    "授权已收到，请返回 CCL 等待验证完成。"
                } else {
                    "授权未完成，请返回 CCL。"
                },
            )
            .await;
            Ok(Some(code))
        }
        Err(_) => {
            respond_callback(
                &mut stream,
                "400 Bad Request",
                "登录回调无效，请返回启动器继续等待或重试。",
            )
            .await;
            Ok(None)
        }
    }
}
async fn wait_for_callback(pending: &Pending) -> ResultT<String> {
    loop {
        if Instant::now() >= pending.expires {
            return Err("浏览器登录已超时，请重新登录".into());
        }
        {
            let s = state().lock().await;
            if s.generation != pending.generation {
                return Err("登录已取消".into());
            }
        }
        match tokio::time::timeout(Duration::from_secs(1), pending.listener.accept()).await {
            Ok(Ok((stream, _))) => {
                if let Some(code) = callback_request(stream, &pending.state_token).await? {
                    return code.ok_or_else(|| "微软账户未完成授权".into());
                }
            }
            Ok(Err(_)) => return Err("本地登录回调连接失败".into()),
            Err(_) => continue,
        }
    }
}
async fn exchange_at(
    client: &reqwest::Client,
    ms_token: &str,
    xbox_url: &str,
    xsts_url: &str,
    mc_url: &str,
) -> ResultT<(String, u64, String, String, String)> {
    let xbox=json_response(client.post(xbox_url).json(&json!({"Properties":{"AuthMethod":"RPS","SiteName":"user.auth.xboxlive.com","RpsTicket":format!("d={ms_token}")},"RelyingParty":"http://auth.xboxlive.com","TokenType":"JWT"})).timeout(Duration::from_secs(30)).send().await.map_err(request_error("Xbox 登录"))?,"Xbox 登录").await?;
    let user = xbox["Token"].as_str().ok_or("Xbox 登录响应缺少令牌")?;
    let xsts=json_response(client.post(xsts_url).json(&json!({"Properties":{"SandboxId":"RETAIL","UserTokens":[user]},"RelyingParty":"rp://api.minecraftservices.com/","TokenType":"JWT"})).timeout(Duration::from_secs(30)).send().await.map_err(request_error("Xbox 授权"))?,"Xbox 授权").await?;
    let hash = xsts["DisplayClaims"]["xui"][0]["uhs"]
        .as_str()
        .ok_or("Xbox 授权响应缺少用户标识")?;
    let xuid = xsts["DisplayClaims"]["xui"][0]["xid"]
        .as_str()
        .or_else(|| xbox["DisplayClaims"]["xui"][0]["xid"].as_str())
        .filter(|id| !id.is_empty() && id.len() <= 24 && id.chars().all(|c| c.is_ascii_digit()))
        .unwrap_or("0")
        .to_string();
    let token = xsts["Token"].as_str().ok_or("Xbox 授权响应缺少令牌")?;
    let mc = json_response(
        client
            .post(format!("{mc_url}/authentication/login_with_xbox"))
            .json(&json!({"identityToken":format!("XBL3.0 x={hash};{token}")}))
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(request_error("Minecraft 登录"))?,
        "Minecraft 登录",
    )
    .await?;
    let access = mc["access_token"]
        .as_str()
        .ok_or("Minecraft 登录响应缺少令牌")?
        .to_string();
    let expires = mc["expires_in"].as_u64().unwrap_or(3600).min(86400);
    let entitlements = json_response(
        client
            .get(format!("{mc_url}/entitlements/mcstore"))
            .bearer_auth(&access)
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(request_error("正版验证"))?,
        "正版验证",
    )
    .await?;
    let owns = entitlements["items"].as_array().is_some_and(|v| {
        v.iter().any(|i| {
            matches!(
                i["name"].as_str(),
                Some("game_minecraft" | "product_minecraft")
            )
        })
    });
    if !owns {
        return Err("当前微软账户没有可用的 Minecraft Java 版授权".into());
    }
    let profile = json_response(
        client
            .get(format!("{mc_url}/minecraft/profile"))
            .bearer_auth(&access)
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(request_error("读取 Minecraft 资料"))?,
        "读取 Minecraft 资料",
    )
    .await?;
    let name = profile["name"]
        .as_str()
        .ok_or("Minecraft 资料缺少玩家名")?
        .to_string();
    let uuid = profile["id"]
        .as_str()
        .ok_or("Minecraft 资料缺少玩家 ID")?
        .to_string();
    if name.is_empty()
        || name.len() > 16
        || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        || uuid.len() != 32
        || !uuid.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err("Minecraft 账户资料无效".into());
    }
    Ok((access, expires, name, uuid, xuid))
}
async fn exchange(
    client: &reqwest::Client,
    ms_token: &str,
) -> ResultT<(String, u64, String, String, String)> {
    exchange_at(client, ms_token, XBOX_URL, XSTS_URL, MC_URL).await
}
async fn redeem_authorization_code(
    client: &reqwest::Client,
    token_url: &str,
    pending: &Pending,
    code: &str,
) -> ResultT<Value> {
    let response = client
        .post(token_url)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", pending.client_id.as_str()),
            ("code", code),
            ("redirect_uri", pending.redirect_uri.as_str()),
            ("code_verifier", pending.verifier.as_str()),
            ("scope", SCOPE),
        ])
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(request_error("微软登录"))?;
    json_response(response, "微软登录")
        .await
        .map_err(|e| format!("{e}；请检查应用客户端 ID 和 localhost 重定向 URI"))
}
#[tauri::command]
pub async fn complete_microsoft_login() -> ResultT<AccountInfo> {
    let pending = state()
        .lock()
        .await
        .pending
        .clone()
        .ok_or("请先开始微软登录")?;
    let code = match wait_for_callback(&pending).await {
        Ok(code) => code,
        Err(error) => {
            let mut s = state().lock().await;
            if s.generation == pending.generation {
                s.pending = None;
            }
            return Err(error);
        }
    };
    {
        let mut s = state().lock().await;
        if s.generation != pending.generation {
            return Err("登录已取消".into());
        }
        s.pending = None;
    }
    let client = http_client()?;
    let body = redeem_authorization_code(&client, TOKEN_URL, &pending, &code).await?;
    let ms = body["access_token"]
        .as_str()
        .ok_or("微软登录响应缺少令牌")?;
    let refresh = body["refresh_token"].as_str().map(str::to_string);
    let (access, expires, name, uuid, xuid) = exchange(&client, ms).await?;
    let session = Session {
        client_id: pending.client_id,
        refresh_token: refresh,
        access_token: access,
        expires: Instant::now() + Duration::from_secs(expires),
        name,
        uuid,
        xuid,
        generation: pending.generation,
    };
    let mut s = state().lock().await;
    if s.generation != pending.generation {
        return Err("登录已取消".into());
    }
    let result = info(&session);
    s.pending = None;
    s.session = Some(session);
    Ok(result)
}
#[tauri::command]
pub async fn open_microsoft_login() -> ResultT<()> {
    let url = {
        let s = state().lock().await;
        s.pending
            .as_ref()
            .ok_or("请先开始微软登录")?
            .authorization_url
            .clone()
    };
    open_browser(&url)
}
#[tauri::command]
pub async fn cancel_microsoft_login() {
    let mut s = state().lock().await;
    s.generation += 1;
    s.pending = None;
}
#[tauri::command]
pub async fn logout_microsoft() {
    let mut s = state().lock().await;
    s.generation += 1;
    s.pending = None;
    s.session = None;
}
#[tauri::command]
pub async fn microsoft_account() -> Option<AccountInfo> {
    state().lock().await.session.as_ref().map(info)
}
async fn session() -> ResultT<Session> {
    let initial = state()
        .lock()
        .await
        .session
        .clone()
        .ok_or("请先登录微软账户")?;
    if initial.expires > Instant::now() + Duration::from_secs(60) {
        return Ok(initial);
    }
    let _refresh = REFRESH_LOCK.get_or_init(|| Mutex::new(())).lock().await;
    let original = state()
        .lock()
        .await
        .session
        .clone()
        .ok_or("请先登录微软账户")?;
    if original.expires > Instant::now() + Duration::from_secs(60) {
        return Ok(original);
    }
    let refresh = original
        .refresh_token
        .as_deref()
        .ok_or("微软登录已过期，请重新登录")?;
    let client = http_client()?;
    let response = client
        .post(TOKEN_URL)
        .form(&[
            ("client_id", original.client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh),
            ("scope", SCOPE),
        ])
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(request_error("刷新微软登录"))?;
    let body = json_response(response, "刷新微软登录").await?;
    let ms = body["access_token"]
        .as_str()
        .ok_or("刷新微软登录失败，请重新登录")?;
    let (access, expires, name, uuid, xuid) = exchange(&client, ms).await?;
    if uuid != original.uuid {
        return Err("刷新后的账户与当前账户不匹配，请重新登录".into());
    }
    let new = Session {
        refresh_token: body["refresh_token"]
            .as_str()
            .map(str::to_string)
            .or(original.refresh_token.clone()),
        access_token: access,
        expires: Instant::now() + Duration::from_secs(expires),
        name,
        uuid,
        xuid,
        ..original.clone()
    };
    let mut s = state().lock().await;
    if s.session
        .as_ref()
        .is_none_or(|current| current.generation != original.generation)
    {
        return Err("账户已退出或切换，请重新登录".into());
    }
    s.session = Some(new.clone());
    Ok(new)
}
pub async fn launch_identity() -> ResultT<LaunchIdentity> {
    let s = session().await?;
    Ok(LaunchIdentity {
        name: s.name,
        uuid: s.uuid,
        xuid: s.xuid,
        access_token: s.access_token,
    })
}

fn png_data(bytes: &[u8], kind: &str) -> ResultT<String> {
    if bytes.len() > 2 * 1024 * 1024 || bytes.len() < 24 {
        return Err("图片必须是小于 2 MB 的 PNG 文件".into());
    }
    let decoder = png::Decoder::new(Cursor::new(bytes));
    let mut reader = decoder.read_info().map_err(|_| "图片不是有效的 PNG 文件")?;
    let (w, h) = (reader.info().width, reader.info().height);
    let valid = if kind == "skin" {
        w == 64 && (h == 64 || h == 32)
    } else if kind == "cape" {
        w == 64 && (h == 32 || h == 64)
    } else {
        return Err("未知图片类型".into());
    };
    if !valid {
        return Err(if kind == "skin" {
            "皮肤尺寸须为 64×64 或 64×32"
        } else {
            "披风尺寸须为 64×32 或 64×64"
        }
        .into());
    }
    let size = reader.output_buffer_size().ok_or("图片数据过大")?;
    if size > 1024 * 1024 {
        return Err("图片数据过大".into());
    }
    let mut decoded = vec![0; size];
    reader
        .next_frame(&mut decoded)
        .map_err(|_| "PNG 图片数据无效")?;
    Ok(format!("data:image/png;base64,{}", BASE64.encode(bytes)))
}
#[tauri::command]
pub async fn preview_texture(path: String, kind: String) -> ResultT<String> {
    let metadata = fs::metadata(&path).map_err(|e| format!("无法读取图片：{e}"))?;
    if !metadata.is_file() || metadata.len() > 2 * 1024 * 1024 {
        return Err("请选择小于 2 MB 的 PNG 文件".into());
    }
    let data = fs::read(path).map_err(|e| format!("无法读取图片：{e}"))?;
    png_data(&data, &kind)
}
async fn texture(client: &reqwest::Client, url: &str, kind: &str) -> ResultT<String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "皮肤地址无效")?;
    if !["http", "https"].contains(&parsed.scheme())
        || parsed.host_str() != Some("textures.minecraft.net")
        || parsed.port().is_some()
    {
        return Err("皮肤地址不受支持".into());
    }
    // Mojang sometimes returns an HTTP texture URL; always fetch it over HTTPS.
    let safe = format!("https://textures.minecraft.net{}", parsed.path());
    let response = client
        .get(safe)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(request_error("获取角色图片"))?
        .error_for_status()
        .map_err(request_error("获取角色图片"))?;
    if response
        .content_length()
        .is_some_and(|n| n > 2 * 1024 * 1024)
    {
        return Err("角色图片过大".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(request_error("获取角色图片"))?;
    png_data(&bytes, kind)
}
#[tauri::command]
pub async fn get_appearance() -> ResultT<Appearance> {
    let session = session().await?;
    let client = http_client()?;
    let profile = json_response(
        client
            .get(format!("{MC_URL}/minecraft/profile"))
            .bearer_auth(&session.access_token)
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(request_error("获取角色外观"))?,
        "获取角色外观",
    )
    .await?;
    let skin = profile["skins"]
        .as_array()
        .and_then(|a| a.iter().find(|s| s["state"] == "ACTIVE"));
    let model = skin
        .and_then(|s| s["variant"].as_str())
        .unwrap_or("CLASSIC")
        .to_ascii_lowercase();
    let skin_texture = if let Some(url) = skin.and_then(|s| s["url"].as_str()) {
        Some(texture(&client, url, "skin").await?)
    } else {
        None
    };
    let mut capes = Vec::new();
    for cape in profile["capes"].as_array().into_iter().flatten() {
        let Some(id) = cape["id"].as_str() else {
            continue;
        };
        let image = if let Some(url) = cape["url"].as_str() {
            texture(&client, url, "cape").await.ok()
        } else {
            None
        };
        capes.push(CapeInfo {
            id: id.into(),
            name: cape["alias"].as_str().unwrap_or("披风").into(),
            active: cape["state"] == "ACTIVE",
            texture: image,
        });
    }
    Ok(Appearance {
        skin: skin_texture,
        model,
        capes,
    })
}
#[tauri::command]
pub async fn upload_account_skin(path: String, model: String) -> ResultT<()> {
    if !["classic", "slim"].contains(&model.as_str()) {
        return Err("皮肤模型无效".into());
    }
    let metadata = fs::metadata(&path).map_err(|e| format!("无法读取皮肤：{e}"))?;
    if !metadata.is_file() || metadata.len() > 2 * 1024 * 1024 {
        return Err("请选择小于 2 MB 的 PNG 皮肤".into());
    }
    let bytes = fs::read(path).map_err(|e| format!("无法读取皮肤：{e}"))?;
    png_data(&bytes, "skin")?;
    let session = session().await?;
    let client = http_client()?;
    let file = reqwest::multipart::Part::bytes(bytes)
        .file_name("skin.png")
        .mime_str("image/png")
        .map_err(|_| "皮肤文件无效")?;
    let form = reqwest::multipart::Form::new()
        .text("variant", model)
        .part("file", file);
    let response = client
        .post(format!("{MC_URL}/minecraft/profile/skins"))
        .bearer_auth(&session.access_token)
        .multipart(form)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(request_error("上传皮肤"))?;
    if !response.status().is_success() {
        return Err(format!(
            "上传皮肤失败（HTTP {}），请检查账号与皮肤格式",
            response.status()
        ));
    }
    Ok(())
}
#[tauri::command]
pub async fn reset_account_skin() -> ResultT<()> {
    let session = session().await?;
    let response = http_client()?
        .delete(format!("{MC_URL}/minecraft/profile/skins/active"))
        .bearer_auth(&session.access_token)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(request_error("恢复默认皮肤"))?;
    if !response.status().is_success() {
        return Err(format!("恢复默认皮肤失败（HTTP {}）", response.status()));
    }
    Ok(())
}
#[tauri::command]
pub async fn set_account_cape(cape_id: Option<String>) -> ResultT<()> {
    let session = session().await?;
    let client = http_client()?;
    let url = format!("{MC_URL}/minecraft/profile/capes/active");
    let request = if let Some(id) = cape_id {
        if id.is_empty()
            || id.len() > 100
            || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return Err("披风 ID 无效".into());
        }
        client.put(url).json(&json!({"capeId":id}))
    } else {
        client.delete(url)
    };
    let response = request
        .bearer_auth(&session.access_token)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(request_error("更新披风"))?;
    if !response.status().is_success() {
        return Err(format!(
            "更新披风失败（HTTP {}），请确认账号拥有该披风",
            response.status()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    fn png_fixture(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut bytes, width, height);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let mut writer = enc.write_header().unwrap();
            writer
                .write_image_data(&vec![255; width as usize * height as usize * 4])
                .unwrap();
        }
        bytes
    }
    #[test]
    fn checks_client_id_and_texture_shape() {
        assert!(valid_client_id("11111111-2222-3333-4444-555555555555"));
        assert!(!valid_client_id("not-an-app-id"));
        assert!(configured_client_id(None).is_err());
        assert!(configured_client_id(Some("11111111-2222-3333-4444-555555555555")).is_ok());
        assert!(png_data(&png_fixture(64, 64), "skin")
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert!(png_data(&png_fixture(32, 32), "skin").is_err());
        assert!(png_data(b"not a png", "cape").is_err());
    }
    #[test]
    fn minecraft_forbidden_errors_distinguish_app_and_account() {
        let status = reqwest::StatusCode::FORBIDDEN;
        let app =
            json!({"errorMessage": "Invalid app registration, see https://aka.ms/AppRegInfo"});
        let account = json!({"details": {"reason": "ACCOUNT_SUSPENDED"}});
        assert!(response_json_error(status, &app, "Minecraft 登录").contains("应用注册未获"));
        assert!(response_json_error(status, &account, "Minecraft 登录").contains("账户被"));
        assert!(response_json_error(status, &json!({}), "Minecraft 登录").contains("服务拒绝访问"));
        assert!(!response_json_error(status, &app, "Xbox 登录").contains("应用注册未获"));
    }
    #[test]
    fn browser_authorization_uses_pkce_and_validates_callback() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let url = authorization_url(
            "11111111-2222-3333-4444-555555555555",
            "http://localhost:4567/",
            verifier,
            "state-value",
        )
        .unwrap();
        let url = reqwest::Url::parse(&url).unwrap();
        let params: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(
            params["code_challenge"],
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        assert_eq!(params["code_challenge_method"], "S256");
        assert_eq!(params["redirect_uri"], "http://localhost:4567/");
        assert_eq!(params["state"], "state-value");
        assert_eq!(
            parse_callback("/?code=auth%2Bcode&state=state-value", "state-value").unwrap(),
            Some("auth+code".into())
        );
        assert!(parse_callback("/?code=x&state=wrong", "state-value").is_err());
        assert!(parse_callback(
            "/?code=x&state=state-value&state=state-value",
            "state-value"
        )
        .is_err());
        assert!(parse_callback("/other?code=x&state=state-value", "state-value").is_err());
        assert_eq!(
            parse_callback("/?error=access_denied&state=state-value", "state-value").unwrap(),
            None
        );
    }
    #[tokio::test]
    async fn local_callback_rejects_wrong_state_and_accepts_valid_browser_response() {
        let listener = Arc::new(
            TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
                .await
                .unwrap(),
        );
        let address = listener.local_addr().unwrap();
        let pending = Pending {
            client_id: "11111111-2222-3333-4444-555555555555".into(),
            verifier: "verifier".into(),
            state_token: "correct-state".into(),
            redirect_uri: format!("http://localhost:{}/", address.port()),
            authorization_url: AUTHORIZE_URL.into(),
            listener,
            expires: Instant::now() + Duration::from_secs(5),
            generation: 42,
        };
        {
            let mut value = state().lock().await;
            value.generation = 42;
            value.pending = Some(pending.clone());
        }
        let task = tokio::spawn(async move { wait_for_callback(&pending).await });
        let mut bad = TcpStream::connect(address).await.unwrap();
        bad.write_all(b"GET /?code=bad&state=wrong HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .await
            .unwrap();
        let mut reply = Vec::new();
        bad.read_to_end(&mut reply).await.unwrap();
        assert!(String::from_utf8_lossy(&reply).starts_with("HTTP/1.1 400"));
        let mut good = TcpStream::connect(address).await.unwrap();
        good.write_all(
            b"GET /?code=temporary-code&state=correct-state HTTP/1.1\r\nHost: localhost\r\n\r\n",
        )
        .await
        .unwrap();
        let mut reply = Vec::new();
        good.read_to_end(&mut reply).await.unwrap();
        let response = String::from_utf8_lossy(&reply);
        assert!(response.starts_with("HTTP/1.1 200"));
        assert!(!response.contains("temporary-code"));
        assert_eq!(task.await.unwrap().unwrap(), "temporary-code");
        cancel_microsoft_login().await;
    }
    #[tokio::test]
    async fn redeem_sends_code_verifier_and_exact_redirect() {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let callback = Arc::new(
            TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
                .await
                .unwrap(),
        );
        let pending = Pending {
            client_id: "11111111-2222-3333-4444-555555555555".into(),
            verifier: "private-verifier".into(),
            state_token: "state".into(),
            redirect_uri: "http://localhost:1234/".into(),
            authorization_url: AUTHORIZE_URL.into(),
            listener: callback,
            expires: Instant::now() + Duration::from_secs(5),
            generation: 1,
        };
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buf = [0u8; 2048];
            loop {
                let n = socket.read(&mut buf).await.unwrap();
                if n == 0 {
                    break;
                }
                request.extend_from_slice(&buf[..n]);
                if let Some(pos) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                    let h = String::from_utf8_lossy(&request[..pos]);
                    let len = h
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|v| v.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if request.len() >= pos + 4 + len {
                        break;
                    }
                }
            }
            let split = request.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
            let body = std::str::from_utf8(&request[split + 4..]).unwrap();
            let parsed = reqwest::Url::parse(&format!("http://localhost/?{body}")).unwrap();
            let fields: std::collections::HashMap<_, _> =
                parsed.query_pairs().into_owned().collect();
            assert_eq!(fields["grant_type"], "authorization_code");
            assert_eq!(fields["code"], "temporary-code");
            assert_eq!(fields["code_verifier"], "private-verifier");
            assert_eq!(fields["redirect_uri"], "http://localhost:1234/");
            let body = r#"{"access_token":"example-token"}"#;
            let response=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let body = redeem_authorization_code(
            &client,
            &format!("http://{address}/token"),
            &pending,
            "temporary-code",
        )
        .await
        .unwrap();
        assert_eq!(body["access_token"], "example-token");
        task.await.unwrap();
    }
    #[tokio::test]
    async fn exchanges_xbox_identity_and_rejects_missing_entitlement() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for n in 0..9 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                let mut buf = [0u8; 4096];
                loop {
                    let count = socket.read(&mut buf).await.unwrap();
                    if count == 0 {
                        break;
                    }
                    request.extend_from_slice(&buf[..count]);
                    if let Some(pos) = request.windows(4).position(|v| v == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&request[..pos]);
                        let len = head
                            .lines()
                            .find_map(|line| {
                                line.to_ascii_lowercase()
                                    .strip_prefix("content-length:")
                                    .and_then(|v| v.trim().parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        if request.len() >= pos + 4 + len {
                            break;
                        }
                    }
                }
                let request = String::from_utf8_lossy(&request);
                let phase = n % 5;
                let body = match phase {
                    0 => {
                        assert!(request.contains("d=ms-secret"));
                        r#"{"Token":"xbox-secret"}"#
                    }
                    1 => {
                        assert!(request.contains("xbox-secret"));
                        r#"{"Token":"xsts-secret","DisplayClaims":{"xui":[{"uhs":"userhash","xid":"12345"}]}}"#
                    }
                    2 => {
                        assert!(request.contains("XBL3.0 x=userhash;xsts-secret"));
                        r#"{"access_token":"mc-secret","expires_in":3600}"#
                    }
                    3 => {
                        assert!(request
                            .to_ascii_lowercase()
                            .contains("authorization: bearer mc-secret"));
                        if n == 8 {
                            r#"{"items":[]}"#
                        } else {
                            r#"{"items":[{"name":"game_minecraft"}]}"#
                        }
                    }
                    _ => r#"{"name":"RealPlayer","id":"0123456789abcdef0123456789abcdef"}"#,
                };
                let response=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
                socket.write_all(response.as_bytes()).await.unwrap();
            }
        });
        let base = format!("http://{address}");
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let result = exchange_at(
            &client,
            "ms-secret",
            &format!("{base}/xbox"),
            &format!("{base}/xsts"),
            &base,
        )
        .await
        .unwrap();
        assert_eq!(result.0, "mc-secret");
        assert_eq!(result.2, "RealPlayer");
        assert_eq!(result.3, "0123456789abcdef0123456789abcdef");
        assert_eq!(result.4, "12345");
        assert!(exchange_at(
            &client,
            "ms-secret",
            &format!("{base}/xbox"),
            &format!("{base}/xsts"),
            &base
        )
        .await
        .unwrap_err()
        .contains("没有可用"));
        server.await.unwrap();
    }
}

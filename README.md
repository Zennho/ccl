# CCL

**CCL 是一个使用 Tauri 2 构建的跨平台 Minecraft: Java Edition 启动器。** 从安装游戏、管理模组到与朋友联机，CCL 希望让这些事情在同一个简洁的界面里完成。

[下载最新版本](https://github.com/Zennho/ccl/releases/latest) · [报告问题](https://github.com/Zennho/ccl/issues) · [服务器目录](https://github.com/Zennho/ccl-server-catalog) · [MIT 许可证](LICENSE)

CCL is an independent, open-source Minecraft: Java Edition launcher for Windows, Linux and macOS. It is not affiliated with Mojang or Microsoft.

## 下载与安装

前往 [Releases](https://github.com/Zennho/ccl/releases) 下载适合自己系统的安装包：

| 平台 | 安装包 |
| --- | --- |
| Windows x64 | `x64-setup.exe` |
| Linux x64 | `amd64.deb` 或 `amd64.AppImage` |
| macOS Apple Silicon | `aarch64.dmg` |
| macOS Intel | `x64.dmg` |

Windows 安装包尚未进行代码签名；macOS 包使用临时签名，尚未经过 Apple 公证，系统可能提示需要手动确认打开。游戏及其资源需要从各发布服务下载。

## 功能

- **游戏与加载器**：安装 Minecraft Java 版正式版，可同时选择 Fabric、Quilt、Forge 或 NeoForge，以及兼容的常用模组。安装前抽样比较官方与 BMCLAPI 镜像线路，优先使用较快的线路，失败时尝试备用线路。
- **Java 管理**：检测本机 Java，下载和管理 Eclipse Temurin Java 8、17、21 和 25，并校验下载文件。可用版本取决于发行商对当前平台的支持。
- **模组与整合包**：浏览、搜索和排序 Modrinth 或 CurseForge 的内容，按页浏览结果并打开项目原站。模组按选定游戏版本和加载器过滤，可选择具体版本、自动安装必需依赖，也可启用、停用和删除已安装的模组。详情页显示项目描述和来源平台提供的网址，并提供 MC 百科词条或搜索入口。整合包使用独立实例目录。
- **下载与版本管理**：最多同时执行三个任务，支持取消等待中或进行中的任务、重试和清理记录。版本可删除；默认保留存档、模组及共用资源，独立实例可选择连同实例数据一起删除。
- **导入与导出**：支持 CCL 游戏包和 PCL 使用的 Modrinth `.mrpack` 格式，可导出模组、游戏与模组配置和资源包，并可选包含世界存档；CCL 格式还支持保存启动参数。导入时创建独立实例，并重新下载游戏与加载器。PCL 兼容导出暂不支持 Quilt，导入整合包中的可选客户端文件会一并安装。
- **账户与外观**：支持离线玩家及微软正版账户；可预览皮肤和披风、上传正版皮肤并切换账户已有披风。主界面横幅和全局背景支持本地图片、透明度、磨砂与模糊调整。
- **多人联机**：为游戏内开放的局域网端口创建 IPv6 转发，分享地址并检测 TCP 连接；也可以浏览每日更新的 [公开服务器目录](https://github.com/Zennho/ccl-server-catalog)。
- **启动设置与日志**：配置游戏目录、Java 路径、内存、G1GC、自定义 JVM 和游戏参数及网络代理。启动日志保存在实例的 `logs/ccl` 目录，可从启动器打开。

## 使用须知

- **正版登录**：CCL 已配置微软应用，玩家无需输入客户端 ID；但该应用仍需获得 Minecraft 服务授权，审核状态以官方回复为准。离线模式无法加入要求正版验证的服务器。登录令牌仅保存在运行时内存中，重启后需要重新登录。
- **CurseForge**：浏览和下载需要自行提供 API Key；部分项目作者不允许第三方启动器下载文件。Modrinth 已安装项目通过文件哈希识别；CurseForge 通过 CCL 安装记录识别。
- **联机与服务器**：跨网络连接需要双方有可互通的 IPv6，房主的路由器与防火墙允许入站 TCP。房间没有额外访问验证，请只向信任的人分享地址。公开服务器的在线状态和人数是每日快照，不代表实时状态。
- **游戏数据**：默认游戏目录位于系统应用数据目录下的 `ccl/minecraft`，可在启动设置中修改。删除版本默认保留共用数据；选择删除独立实例数据时，实例内的存档和模组也会删除。导出包不包含日志、截图和账户信息。
- **下载**：取消任务时会清理临时文件，已完成的共用游戏资源可以保留并在重新安装时复用。若整合包取消前已完成游戏本体或加载器安装，这些内容也会保留。任务记录仅在当前运行期间保存。

## 从源码开发

### 环境准备

安装 Node.js 22、Rust，以及 [Tauri 2 对应平台的系统依赖](https://v2.tauri.app/start/prerequisites/)。Linux 构建需要 WebKitGTK 等开发包，Windows 需要 Microsoft C++ 构建工具和 WebView2，macOS 需要 Xcode 命令行工具；以 Tauri 文档为准。

```bash
git clone https://github.com/Zennho/ccl.git
cd ccl
npm ci
npm run tauri dev
```

常用命令：

```bash
npm test                                   # 界面及交互测试
cargo test --manifest-path src-tauri/Cargo.toml --locked  # Rust 后端测试
npm run build                              # 构建前端资源
npm run tauri build                        # 构建当前平台的桌面安装包
```

桌面安装包通常需要在对应操作系统上构建。项目的 [发布工作流](.github/workflows/release.yml) 分别构建 Windows、Linux 和两种 macOS 架构，并在所有构建成功后发布。

构建者可以通过 `CCL_MICROSOFT_CLIENT_ID` 环境变量覆盖默认微软应用 ID。自行注册的应用需要支持个人账户、启用公共客户端流程、将 `http://localhost` 注册为移动和桌面应用重定向 URI，并获得 Minecraft 服务授权；参考 [微软桌面应用注册文档](https://learn.microsoft.com/en-us/azure/active-directory/develop/scenario-desktop-app-registration)。

## 项目结构

```text
src/                  界面、交互与样式
src-tauri/src/        Tauri 命令、游戏安装、账户与其他后端功能
tests/                界面交互测试
.github/workflows/    跨平台构建与发布流程
```

## 参与贡献

欢迎提交 [Issue](https://github.com/Zennho/ccl/issues) 或 Pull Request。报告问题时请提供系统、CCL 版本、复现步骤以及相关日志；提交代码前请运行适用的测试，并说明修改内容和验证方式。涉及账户、代理或日志时，请先移除密码、令牌和其他个人信息。

## 许可证与声明

本项目采用 [MIT License](LICENSE)，第三方组件许可见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。Minecraft、Mojang 和 Microsoft 是其各自所有者的商标；CCL 是独立项目，与 Mojang 或 Microsoft 没有隶属关系。

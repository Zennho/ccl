# CCL

使用 Tauri 2 构建的跨平台 Minecraft Java 版启动器，支持 Windows、Linux 和 macOS。

CCL is an independent, open-source Minecraft: Java Edition launcher built with Tauri. It supports game and Java installation, mod management, and Microsoft account sign-in for players who own the game. Microsoft sign-in requires the launcher's application ID to be approved for Minecraft services. CCL is not affiliated with Mojang or Microsoft.

## 开发与打包

安装 Node.js、Rust 和 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)，然后运行：

```sh
npm install
npm run tauri dev
npm run tauri build
npm test
```

Windows、Linux、macOS 安装包一般需要分别在对应平台构建。游戏数据默认保存在系统应用数据目录下的 `ccl/minecraft`。

## 功能

- 从 Mojang 版本清单安装原版正式版；官方线路不可用时尝试 BMCLAPI 备用镜像。
- 选择 Minecraft 版本后，可在安装窗口选择 Fabric、Quilt、Forge 或 NeoForge，并可选装兼容的常用模组。Forge 系列使用所选 Java 运行官方安装程序，部分旧版安装器和特殊版本可能不兼容。
- 检测本机 Java，下载和管理 Eclipse Temurin Java 8、17、21、25；自动校验 SHA-256。发行商没有提供的平台组合会提示无法下载。
- 从 Modrinth 或 CurseForge 搜索模组与整合包。可为模组选择已安装实例及兼容版本，自动安装必需依赖并标记已安装项目。Modrinth 通过文件哈希识别已有模组；CurseForge 根据 CCL 安装记录识别，其他方式安装的模组仍可在实例模组列表中查看。CurseForge 需要自行提供 API Key，且部分作者不允许第三方启动器下载其文件。
- 整合包使用独立实例目录，支持 Modrinth `.mrpack` 和 CurseForge 整合包格式。可启用、停用或删除当前实例的模组。
- 版本管理支持导出 CCL 游戏包（模组、游戏及模组配置、资源包和启动参数，可选世界存档），并导入为独立实例。导入时联网获取游戏本体及对应加载器，Forge 系列需要兼容的 Java；可选择是否覆盖本机启动参数。日志、截图和启动器账号不包含在导出包中。
- 下载中心最多并行执行 3 个任务；游戏资源和整合包文件并发下载，相同文件会复用。任务列表仅在本次运行中保留，退出应用会中断下载；重新安装可复用已完成的游戏文件。
- 支持离线用户名或微软正版账户启动，提供账号皮肤上传、默认皮肤恢复、已拥有披风切换以及本地皮肤和披风预览。正版登录通过系统浏览器授权并回调本地启动器，令牌仅保存在本次运行的内存中，重启需要重新登录。
- 多人联机支持 IPv6：房主先在游戏中对局域网开放并输入游戏显示的端口，CCL 为该本机端口建立 IPv6 TCP 转发，显示可分享的地址；朋友可检测 TCP 连接，并在游戏中使用“多人游戏 → 直接连接”。跨网络联机需要可互通的 IPv6 和允许入站的防火墙/路由器；显示公网候选地址不保证外网可达。房间无额外访问验证，只应将地址分享给可信任的人；关闭房间或启动器会断开转发。
- 多人联机页提供公开 Java 服务器目录，可按名称、地址、玩法和版本搜索、按快照状态筛选并复制地址。目录由独立的 [CCL 服务器目录仓库](https://github.com/Zennho/ccl-server-catalog)每天从 [Minecraft Java Servers](https://minecraft-java-servers.com/)公共 API 更新；人数和在线状态不是实时数据，具体可用性及加入要求以服务器为准。
- 正版登录默认使用项目配置的微软应用 ID，终端玩家无需输入；构建时可通过环境变量 `CCL_MICROSOFT_CLIENT_ID` 覆盖。该应用需支持个人账户、启用公共客户端流程、将 `http://localhost` 注册为移动和桌面应用重定向 URI，并获 Minecraft 服务授权；未获授权的构建不能完成正版登录。参考 [微软桌面应用注册说明](https://learn.microsoft.com/en-us/azure/active-directory/develop/scenario-desktop-app-registration) 和 [Xbox 登录说明](https://learn.microsoft.com/en-us/xbox/gdk/docs/services/fundamentals/s2s-auth-calls/service-authentication/live-website-authentication)。
- 支持调整 Java 路径、游戏目录、最大内存，启用 G1GC，以及设置自定义 JVM 和游戏参数。启动日志保存在实例的 `logs/ccl` 目录，启动页可打开最近一次日志；进程异常退出时可打开对应日志。游戏内版本类型设置为 `CCL 0.1.0`；加载器显示的“已修改”等标识由加载器或游戏决定。
- 自动使用系统代理，也可在启动设置中填写 HTTP、HTTPS 或 SOCKS5 代理地址。

离线模式不能用于需要正版验证的服务器。游戏安装和 Java、模组下载均需要能够访问对应的发布服务。

## 许可证

CCL 使用 [MIT License](LICENSE) 发布。第三方组件的版权和许可说明见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。

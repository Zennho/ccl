Compass Craft Launcher（CCL）是支持 Windows、Linux 和 macOS 的 Minecraft Java 版启动器。

本次更新：

- 模组与资源列表和详情支持中文介绍，并可切换回原文；匹配成功的模组和整合包可以直接打开 MC 百科条目。中文译文来自第三方服务，AI 译文可能有误；无法获取时会显示原文或百科搜索入口。
- macOS 正版账户改为在本地保存登录状态，减少钥匙串重复授权。旧版钥匙串账户需要重新通过浏览器登录一次；令牌保存在权限限制为当前用户读写的未加密文件中。
- 当前实例的手动内存配置增加滑动条，也可以继续输入具体数值。
- 改进账户保存失败时的提示和重试，完善凭据保存及恢复的自动化检查。

Windows x64 下载 `.exe` 安装程序；Linux x64 下载 `.deb` 或 `.AppImage`；macOS Apple Silicon 选择 `aarch64`，Intel 选择 `x64` 的 `.dmg`。

Linux 自动登录需要可用并已解锁的 Secret Service（如 GNOME Keyring 或 KWallet）。macOS 包使用临时签名，尚未经过 Apple 公证；Windows 包未进行代码签名，系统可能要求手动确认打开。

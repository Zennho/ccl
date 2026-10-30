# 应用组装

`src/main.ts` 按读取配置、创建功能模块、连接视图和事件、启动应用的顺序组装启动器。

| 位置 | 职责 |
| --- | --- |
| `features/account.ts` | 连接账户恢复、登录操作、头像缓存和皮肤管理 |
| `features/content.ts` | 连接内容搜索、详情、本地资源管理和下载完成后的刷新 |
| `features/instances.ts` | 连接实例配置、主题、游戏档案、版本列表和删除 |
| `view.ts` | 连接 React 页面、弹窗、外壳和输入状态保护 |
| `events.ts` | 创建操作处理器并注册窗口、表单和点击事件 |
| `actions/` | 按功能处理用户操作 |
| `startup.ts` | 恢复本地数据、订阅桌面事件、启动后台检查 |
| `install-addons.ts` | 安装游戏时的推荐附加模组 |

业务控制器在 `src/lib/`，React 组件在 `src/react/`。下载队列入口为 `src/job-manager.ts`，任务历史和进度计算分别位于 `src/job-history.ts` 和 `src/job-progress.ts`。新增业务逻辑应放在对应控制器中，组装模块负责传递依赖和适配后端命令。

初始化时先创建功能模块，再创建依赖这些模块的视图。功能模块接收的渲染回调会延迟访问视图，因此构造函数不得同步调用渲染回调或开始异步加载；事件注册和 `startApplication` 位于组装完成之后。

通过 `account.appearance.refreshAppearance` 等模块方法访问功能，避免在入口重复声明函数别名。跨模块协作在入口显式连接，不引入全局服务查找表。

运行 `npm run check` 检查类型、交互和构建。JSDOM 测试通过 `tests/react-renderer-helper.cjs` 加载真实 TypeScript 模块；新增组装模块时，同步更新加载清单。`tests/content-feature.test.cjs` 覆盖下载完成后不同实例、资源类型和页面状态下的刷新行为。

前端 TypeScript 和 TSX 使用 Prettier 统一格式。运行 `npm run format` 更新格式，`npm run format:check` 检查格式；`npm run check` 已包含格式检查。

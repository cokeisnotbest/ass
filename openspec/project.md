# Project Context

## Purpose
Visual Studio Code (Code - OSS) 是微软开发的开源代码编辑器。本项目是 VS Code 的源代码仓库，提供代码编辑、导航、调试、扩展系统等核心功能，支持 Windows、macOS 和 Linux 平台。

## Tech Stack
- **语言**: TypeScript (主要), JavaScript
- **运行时**: Electron (桌面), Node.js (后端/CLI), Browser (Web 版)
- **构建工具**: Gulp, Webpack, ESBuild
- **包管理**: npm
- **测试框架**: Mocha, Playwright
- **Linting**: ESLint (自定义规则), Stylelint
- **CLI**: Rust (cli/ 目录)

## Project Conventions

### Code Style
- 使用 TypeScript 严格模式
- 类名使用 PascalCase
- 私有/保护成员使用下划线前缀 (`_memberName`)
- 使用 `curly` 括号，即使单行语句
- 使用分号结尾
- 文件头部必须包含 MIT 许可证注释块
- 避免显式 `any` 类型（有严格的豁免列表）
- 使用 `prefer-const`

### Architecture Patterns
- **分层架构**: common → node/browser → electron-browser/electron-main
- **依赖注入**: 使用 `createDecorator` 定义服务接口
- **事件驱动**: 使用 `Event<T>` 和 `Emitter<T>` 模式
- **Disposable 模式**: 资源管理使用 `IDisposable` 接口
- **多窗口支持**: DOM 操作需考虑多窗口场景，使用 `DOM.getWindow(element)`
- **国际化**: 使用 `nls.localize()` 进行字符串本地化

### Testing Strategy
- 单元测试: `src/**/*.test.ts`
- 集成测试: `test/integration/`
- 冒烟测试: `test/smoke/`
- Monaco 编辑器测试: `test/monaco/`
- 使用 `ensureNoDisposablesAreLeakedInTestSuite()` 检测资源泄漏

### Git Workflow
- 主分支: `main`
- PR 需要通过 CI 检查
- 使用 GitHub Actions 进行自动化
- 提交前运行 `npm run precommit` (hygiene check)

## Domain Context
- **扩展系统**: 扩展运行在独立的 Extension Host 进程
- **工作区**: 支持单文件夹和多根工作区
- **远程开发**: 支持 SSH、容器、WSL 等远程环境
- **编辑器**: 基于 Monaco Editor，支持语法高亮、智能感知、调试等
- **平台抽象**: 通过分层实现跨平台兼容

## Important Constraints
- 不得使用 `path` 模块，使用 `vs/base/common/path.ts`
- 浏览器层禁止直接访问 `document`、`window` 等全局对象
- 使用 `@xterm/xterm` 替代旧的 xterm.js
- 避免使用 `querySelector` 等 DOM 选择器

## External Dependencies
- **Electron**: 桌面应用框架
- **xterm.js**: 终端模拟器
- **Monaco Editor**: 代码编辑器核心
- **Tree-sitter**: 语法解析
- **Ripgrep**: 文件搜索
- **Language Servers**: LSP 协议实现语言智能

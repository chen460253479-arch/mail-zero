# Zero 邮件新手引导完整移除设计

## 目标

完整移除邮件页面首次进入时显示的 “Welcome to Zero Email” 新手引导，不保留隐藏组件、功能开关、兼容分支或仅为该功能存在的依赖。

## 删除边界

- 从 `apps/mail/app/(routes)/mail/layout.tsx` 删除 `OnboardingWrapper` 的导入和渲染。
- 删除 `apps/mail/components/onboarding.tsx`，包括六步引导、远程图片引用、彩带效果以及 `hasCompletedOnboarding` 本地存储状态。
- 从三个现有 Playwright 用例中删除检测并关闭欢迎弹窗的兼容逻辑：
  - `packages/testing/e2e/mail-actions.spec.ts`
  - `packages/testing/e2e/mail-inbox.spec.ts`
  - `packages/testing/e2e/search-bar.spec.ts`
- 从 `apps/mail/package.json` 删除仅由引导组件使用的 `canvas-confetti` 和 `@types/canvas-confetti`，并离线同步 `pnpm-lock.yaml`。

## 保留边界

- 不改变登录、邮箱绑定、首次同步或空邮箱页面。
- 不清理浏览器中已有的 `hasCompletedOnboarding` 键；组件删除后该键不会再被读取或写入，主动遍历用户浏览器存储没有收益。
- 不修改通用 Dialog、Button 或布局组件。

## 回归保护

在现有邮件架构测试中增加约束，验证：

- 新手引导组件文件不存在。
- 邮件布局不再导入或渲染新手引导。
- E2E 用例不再包含欢迎弹窗兼容代码。
- Mail 前端依赖清单不再声明 `canvas-confetti` 或其类型包。

测试必须先在现状下因上述遗留而失败；删除完成后再转为通过。

## 验收标准

- 进入任意 `/mail/*` 页面时不再出现新手引导弹窗。
- 代码库中不存在 `OnboardingDialog`、`OnboardingWrapper`、`hasCompletedOnboarding` 或 “Welcome to Zero Email” 引用。
- `canvas-confetti` 和 `@types/canvas-confetti` 不再是直接依赖。
- 架构测试、Mail 前端测试、类型检查和生产构建通过。
- 工作区不留下构建缓存或临时文件。

# MCP OAuth 与认证残留清理设计

日期：2026-07-28

## 目标

完成 Agent、Chat、Brain、AI 与 MCP 的硬删除，清除 Better Auth MCP/OIDC Provider 遗留的
HTTP Discovery 入口和数据库模型，同时保留 Zero 正常登录、API Bearer/JWT 认证以及 Gmail
OAuth 所需的数据。

## 删除边界

- 删除 `oAuthDiscoveryMetadata` 导入。
- 删除 `/.well-known/oauth-authorization-server` MCP OAuth Discovery 路由。
- 删除 `auth.oauth_application`、`auth.oauth_access_token`、`auth.oauth_consent` 三张未被当前
  认证配置使用的 OIDC Provider 表。
- 从唯一 `0000` 开发初始化 SQL、Drizzle 快照和结构测试中同步删除上述三张表。

## 保留边界

- 保留 Better Auth 用户、会话、验证码和账户表。
- 保留 `jwt()`、`bearer()` 与 `auth.jwks`，它们服务于 Zero 自身 API 认证。
- 保留 `integration.oauth_session`，它用于 Gmail OAuth 验证与邮箱绑定，不属于 MCP。
- 保留 `integration.authorization_binding` 和加密凭据存储。

## 普通认证修复

`getActiveConnection` 在用户没有邮箱时调用当前会话的 `signOut` 即可。现有代码随后又调用
`signOut`，因此前置的 `revokeSession({ headers })` 是重复操作，而且不符合当前 Better Auth
要求传入 token body 的 API 签名。删除该重复调用，不改变正常登录或退出流程。

## 验收

- 架构测试禁止 MCP OAuth Discovery 导入、路由和三张 OIDC Provider 表重新出现。
- 架构测试禁止 `getActiveConnection` 再调用 `revokeSession`，同时确认保留 `signOut`。
- Drizzle 只保留一个 `0000` 初始化模板，并且 `db:generate` 不产生 `0001`。
- 服务端 TypeScript 检查不再报告 MCP OAuth 或 `revokeSession` 类型错误。

# 邮件列表重要标记与操作提示设计

## 目标

让邮件列表与正文使用同一份关键词状态展示“重要”，并为仅图标形式的“移动到文件夹”和“管理标签”按钮补充可见的鼠标悬停提示。

## 已确认方案

- 列表继续使用现有乐观关键词与标签状态，不新增独立状态；`IMPORTANT` 与 `STARRED` 使用同一个已验证的关键词合并规则即时进入展示标签集合。
- `IMPORTANT` 在 `MailLabels` 中渲染与正文一致的橙色闪电图标；`STARRED` 保持现有黄色星标。
- `MoveToFolderMenu` 和 `LabelPicker` 在没有文字 `label` 时显示 Tooltip；带文字的批量操作按钮不重复显示 Tooltip。
- Tooltip 文案复用现有 Paraglide 文案：`common.mailboxes.moveToFolder` 与 `common.mailboxes.manageLabels`。
- 不改变关键词提交、文件夹移动、标签选择及后端接口。

## 数据流

`threadPage` 返回的标签与乐观关键词状态合并为 `optimisticLabels`，列表标签组件据此映射系统图标。文件夹和标签菜单仅增强各自 Popover Trigger 的展示层，不参与数据提交。

## 验收标准

- `IMPORTANT` 存在时列表显示橙色闪电，取消后消失。
- 星标展示保持不变。
- 鼠标悬停仅图标的文件夹或标签按钮时显示对应提示。
- 点击按钮仍正常打开原有 Popover。
- 批量操作中已有文字的按钮不显示重复 Tooltip。

## 移动菜单本地化补充

- 系统邮箱不展示后端英文名称，而是按 `role` 复用现有 `navigation.sidebar.*` 文案。
- `inbox`、`archive`、`junk`、`trash` 分别显示当前语言下的收件箱、归档、垃圾邮件、回收站。
- 自定义文件夹名称属于用户数据，保持原样。
- 搜索和渲染使用同一个显示名称，中文界面可以用中文系统邮箱名称搜索。

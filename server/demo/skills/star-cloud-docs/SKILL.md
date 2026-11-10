---
name: star-cloud-docs
description: 星云云产品文档知识库。回答关于星云云计费、退款、发票、云服务器规格、数据库备份、账号安全、SLA、对象存储、技术支持、地域与容器服务的问题时使用。
---

# 星云云产品文档

本技能包含星云云的官方产品文档，位于 `references/` 目录，每个主题一个 Markdown 文件：

| 文件 | 主题 |
| --- | --- |
| `references/退款政策.md` | 按量 / 包年包月退款规则 |
| `references/发票开具指南.md` | 发票类型、开票金额、申请路径 |
| `references/云服务器规格说明.md` | G7 / C7 / M7 规格与适用场景 |
| `references/数据备份与恢复.md` | 云数据库自动备份、保留期、计费 |
| `references/账号安全最佳实践.md` | MFA、子账号、AccessKey 轮换、登录锁定 |
| `references/服务等级协议SLA.md` | 可用性承诺与赔偿 |
| `references/对象存储计费.md` | 存储类型价格、最短存储时间、流量费 |
| `references/技术支持与工单.md` | 支持计划与响应时间 |
| `references/地域与可用区.md` | 地域列表与跨地域互联 |
| `references/容器服务快速入门.md` | NKE 集群、控制面计费、自动伸缩 |

## 使用方法

1. 根据问题判断主题，用 `read_file` 读取对应文件；不确定时先用 `search_files` 检索。
2. 只依据文档内容作答，引用具体数值（天数、价格、百分比）。文档没有的信息要说明不知道。
3. 需要计算对象存储费用时，可执行 `scripts/oss_price.py <存储类型> <GB>`（standard / infrequent / archive）。

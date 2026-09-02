# 集合竞价微信简报配置

## 1. 配置 Server酱

登录 [Server酱](https://sct.ftqq.com/)，绑定微信并取得 SendKey。在
`server/.env` 中增加：

```dotenv
AUCTION_PUSH_ENABLED=true
SERVERCHAN_SEND_KEY=SCT-your-send-key-here
AUCTION_BRIEF_AI_ENABLED=true
AUCTION_BRIEF_AI_TIMEOUT_MS=4000
```

SendKey 只能保存在本机 `server/.env`。接口响应、日志和每日简报归档均不回显该值。

## 2. 测试微信通道

后端运行后执行：

```powershell
Invoke-RestMethod -Method Post http://localhost:3002/api/ladder/notifications/serverchan/test
```

该操作会实际消耗一条 Server酱额度。正常交易日固定发送两条：

- 09:28：使用冻结的9:25竞价终值和9:15-9:25过程数据。
- 09:35：在首个有效确认快照生成后发送承接更新。

## 3. 安装本机自启

在项目根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-auction-autostart.ps1
```

任务会在用户登录及周一至周五09:05尝试启动前后端。启动脚本会检查端口，避免重复启动；
后端12秒后仍未监听时写入 `.runtime/startup.err.log`，并在通知配置可用时发送启动失败告警。

立即验证任务：

```powershell
Start-ScheduledTask -TaskName 'AshareAuctionBrief'
Get-ScheduledTaskInfo -TaskName 'AshareAuctionBrief'
```

前端地址为 `http://localhost:3000/ladder`，后端地址为
`http://localhost:3002`。电脑需要在09:15前开机、登录并联网。

## 4. 归档与降级

每日结构化简报和投递记录位于 `docs/ladder/YYYY-MM-DD/`：

- `auction-brief-limit-ladder-v3.json`
- `notification-delivery-limit-ladder-v3.json`

部分数据源失败时仍发送带覆盖率和警告的规则简报。若9:25冻结快照完全缺失，只发送数据缺失
告警，不使用9:35累计成交额伪装竞价额。AI超时、失败或输出越界时自动回退规则模板。

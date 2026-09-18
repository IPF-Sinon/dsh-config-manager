# dist — 供真机测试的构建产物

`dsh-config-manager` 的测试构建（**不发 npm**：同名包属于上游作者；源在分支 `fix/credentials-refs-and-workspace-dirs` 与 `feat/session-partition`）。
放在这里是为了让容器能从 CDN 下载（GitHub release 直连在国内常被拦）。

安装（App 终端里）：

```bash
dsh plugin --profile web add https://cdn.jsdelivr.net/gh/IPF-Sinon/dsh-config-manager@pkg-0.1.62-test.1/dsh-config-manager-0.1.62.tgz
```

回滚：

```bash
dsh plugin --profile web add dsh-config-manager@0.1.59
```

sha256 见同目录 `.sha256` 文件。

# dist — 供真机测试的构建产物

这是 `dsh-config-manager` 0.1.60 的测试构建（源在分支 `fix/credentials-refs-and-workspace-dirs`）。
**不发 npm**（同名包属于上游作者），只用 jsDelivr/CDN 或本地文件装到设备上验证。

安装：

```bash
dsh plugin --profile web add https://cdn.jsdelivr.net/gh/IPF-Sinon/dsh-config-manager@pkg-0.1.60-test.1/dsh-config-manager-0.1.60.tgz
```

回滚：

```bash
dsh plugin --profile web add dsh-config-manager@0.1.59
```

sha256：见同目录 `dsh-config-manager-0.1.60.tgz.sha256`。

# Ubuntu 24.04 Docker 公网部署教程

本文用于把通用测试用例管理平台部署到 Ubuntu 24.04 云服务器。目标配置如下：

- 访问域名：`test.maimu.fun`
- HTTPS：由 Caddy 自动申请和续期证书
- 登录用户名：`qzz`
- 应用：Node.js 24 单实例容器
- 数据库：SQLite，持久化到仓库目录下的 `data/`
- 时区：`Asia/Shanghai`

密码不要写入 Git 仓库，也不要发送到聊天中。以下命令中出现的 `SERVER_IP` 必须替换为阿里云服务器的真实公网 IP。

## 一、理解部署结构

浏览器只访问 Caddy 的 80/443 端口。Caddy 完成 HTTPS 和统一密码认证后，把请求转发给 Docker 内部的 `app:3000`。应用的 3000 端口没有发布到宿主机，因此不能从公网直接绕过认证访问。

宿主机的 `./data` 挂载到应用容器的 `/app/data`。删除或重建应用容器不会删除数据库，但删除宿主机的 `data/` 会删除实际业务数据。

## 二、配置阿里云安全组

在阿里云 ECS 控制台找到实例使用的安全组，增加入方向规则：

| 协议 | 端口 | 来源 | 用途 |
| --- | ---: | --- | --- |
| TCP | 22 | 推荐仅你的固定公网 IP；没有固定 IP 时临时使用 `0.0.0.0/0` | SSH |
| TCP | 80 | `0.0.0.0/0` | HTTPS 跳转和证书申请 |
| TCP | 443 | `0.0.0.0/0` | HTTPS 网站 |

不要开放 3000 端口。若启用了 Ubuntu 的 UFW，还需要执行：

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

执行 `ufw enable` 前必须先允许 OpenSSH，否则可能中断远程登录。

## 三、配置域名解析

在 `maimu.fun` 使用的 DNS 控制台添加记录：

- 主机记录：`test`
- 记录类型：`A`
- 记录值：阿里云服务器真实公网 IP
- TTL：使用默认值

在服务器上检查解析：

```bash
getent ahostsv4 test.maimu.fun
```

返回地址必须与服务器公网 IP 一致。解析尚未生效时不要反复启动 Caddy申请证书。

## 四、安装 Docker 与 Git

以下方式使用 Docker 官方 APT 仓库：

```bash
apt update
apt install -y ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
```

创建 Docker 软件源。命令会自动读取服务器架构和 Ubuntu 代号：

```bash
DOCKER_ARCH=$(dpkg --print-architecture)
UBUNTU_CODENAME=$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME}
Components: stable
Architectures: ${DOCKER_ARCH}
Signed-By: /etc/apt/keyrings/docker.asc
EOF
unset DOCKER_ARCH UBUNTU_CODENAME
```

安装并验证：

```bash
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker version
docker compose version
docker run --rm hello-world
```

如果中国内地服务器访问 `registry-1.docker.io` 超时，请在阿里云容器镜像服务 ACR 的“镜像工具 → 镜像加速器”页面取得当前账号的专属地址，然后创建 `/etc/docker/daemon.json`：

```json
{
  "registry-mirrors": [
    "https://你的专属编号.mirror.aliyuncs.com"
  ]
}
```

保存后验证并重启 Docker：

```bash
python3 -m json.tool /etc/docker/daemon.json
dockerd --validate --config-file=/etc/docker/daemon.json
systemctl restart docker
docker info | sed -n '/Registry Mirrors/,+3p'
docker run --rm hello-world
```

不要使用来源不明的公共镜像站，也不要把专属地址替换成示例占位值后直接执行。

如果专属加速器对某个 Docker Official Image 返回 `not found`，本项目已经将 Node 和 Caddy 基础镜像指向 AWS Public ECR 中的 Docker Official Images 同步库。该仓库支持匿名拉取，不需要 AWS 账号：

```bash
docker pull public.ecr.aws/docker/library/node:24-bookworm-slim
docker pull public.ecr.aws/docker/library/caddy:2-alpine
```

## 五、拉取项目代码

仓库是公开仓库，不需要 GitHub 凭据：

```bash
mkdir -p /data
cd /data
git clone https://github.com/Mai-Mu/universal-test-platform.git
cd /data/universal-test-platform
git status
git log -1 --oneline
```

确认当前分支为 `main`，工作区没有改动，并记录最后一个提交。

## 六、迁移现有 SQLite 数据库

先在服务器创建目录：

```bash
mkdir -p /data/universal-test-platform/data/backups
```

在 Windows 电脑的 PowerShell 中执行上传。使用本项目生成并校验过的部署快照，不要上传仓库根目录那个 0 字节的 `testcases.db`：

```powershell
scp "C:\Projects\tamagawa-test-case\data\deployment\testcases.db" root@SERVER_IP:/data/universal-test-platform/data/testcases.db
```

回到服务器，检查文件并把目录交给镜像内的 `node` 用户（UID 1000）：

```bash
cd /data/universal-test-platform
ls -lh data/testcases.db
chown -R 1000:1000 data
chmod 750 data data/backups
chmod 640 data/testcases.db
```

## 七、生成网站密码

复制环境变量模板：

```bash
cd /data/universal-test-platform
cp .env.example .env
```

交互式输入密码并生成哈希。输入过程不会显示字符：

```bash
read -rsp '请输入网站访问密码: ' SITE_PASSWORD; echo
PASSWORD_HASH=$(docker run --rm public.ecr.aws/docker/library/caddy:2-alpine caddy hash-password --plaintext "$SITE_PASSWORD")
unset SITE_PASSWORD
printf '%s\n' "$PASSWORD_HASH"
```

编辑 `.env`：

```bash
nano .env
```

保持以下结构，把占位文字替换成刚生成的完整哈希；哈希外面的单引号必须保留：

```dotenv
SITE_ADDRESS=test.maimu.fun
BASIC_AUTH_USERNAME=qzz
BASIC_AUTH_HASH='$2a$...完整哈希...'
TZ=Asia/Shanghai
```

保存后限制权限并清除当前终端中的哈希变量：

```bash
chmod 600 .env
unset PASSWORD_HASH
```

`.env` 已被 Git 忽略，不会提交到仓库。

## 八、理解并验证 Compose 配置

先查看将要启动的服务：

```bash
docker compose config --services
docker compose config --images
```

预期服务为 `app` 和 `caddy`。应用镜像由 GitHub Actions 自动构建并发布到 GitHub Container Registry；Caddy 使用官方镜像。服务器不再编译应用。

查看 Dockerfile 的关键步骤：

```bash
sed -n '1,200p' Dockerfile
```

其中 `FROM` 选择 Node.js 24 基础镜像，`npm ci --omit=dev` 根据锁文件安装生产依赖，`USER node` 让应用以非 root 用户运行，`HEALTHCHECK` 定期检查 API。

## 九、拉取 GitHub 构建好的镜像

```bash
cd /data/universal-test-platform
docker compose pull
docker compose images
```

GitHub Actions 会在 `main` 分支更新后自动构建并验证应用镜像。服务器这里只下载成品镜像，不再下载 Node.js 构建依赖。拉取完成后应看到 `ghcr.io/mai-mu/universal-test-platform` 和 Caddy 镜像。

## 十、启动服务

启动前必须同时满足：域名已指向服务器、80/443 已开放、`.env` 已写入有效密码哈希。

```bash
docker compose up -d
docker compose ps
docker compose logs --tail=100 app
docker compose logs --tail=100 caddy
```

预期结果：

- `app` 状态最终为 `healthy`；
- `caddy` 状态为 `running`；
- Caddy 日志显示已为 `test.maimu.fun` 获得证书；
- 浏览器访问 `https://test.maimu.fun` 时先要求输入用户名和密码。

## 十一、部署后验证

在服务器本机确认未认证请求被拒绝：

```bash
curl -I https://test.maimu.fun
```

预期返回 `HTTP/2 401`。再使用用户名并交互式输入密码验证：

```bash
curl -I -u qzz https://test.maimu.fun
```

然后在浏览器中检查：

1. HTTPS 锁标志正常，证书域名为 `test.maimu.fun`。
2. 使用 `qzz` 和自设密码能够进入首页。
3. 首页显示的项目数和用例数与迁移前记录一致。
4. 修改一条测试备注，刷新后仍然存在。
5. 手动创建一份备份，列表中能下载该文件。

检查持久化数据和日志：

```bash
ls -lh data/testcases.db data/backups
docker compose logs --tail=100
```

## 十二、日常管理

查看状态：

```bash
cd /data/universal-test-platform
docker compose ps
```

查看实时日志：

```bash
docker compose logs -f --tail=100
```

停止和启动：

```bash
docker compose stop
docker compose start
```

重新启动：

```bash
docker compose restart
```

`docker compose down` 会删除容器和网络，但不会删除 `./data` 或命名卷。不要执行 `docker compose down -v`，因为 `-v` 会删除 Caddy 保存证书的命名卷。

## 十三、更新应用

更新前先创建数据库备份，并确认 Git 工作区干净：

```bash
cd /data/universal-test-platform
git status
git pull --ff-only origin main
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100
```

Compose 只替换使用旧镜像的容器，宿主机 `data/` 中的数据库不会随镜像更新而丢失。

## 十四、回滚应用版本

GitHub 同时为每次构建发布提交哈希标签。先在 GitHub Actions 或提交历史中取得要回滚到的完整提交哈希，然后编辑服务器上的 `.env`：

```dotenv
APP_IMAGE=ghcr.io/mai-mu/universal-test-platform:完整提交哈希
```

拉取该版本并重新创建应用容器：

```bash
docker compose pull app
docker compose up -d app
docker compose ps
```

恢复最新版时，将 `.env` 改回：

```dotenv
APP_IMAGE=ghcr.io/mai-mu/universal-test-platform:latest
```

然后再次执行 `docker compose pull app && docker compose up -d app`。数据库结构变更可能无法仅靠回滚镜像撤销，因此版本升级前必须保留可下载的数据库备份。

## 十五、常见问题

### Caddy 无法签发证书

依次检查：

```bash
getent ahostsv4 test.maimu.fun
ss -lntp | grep -E ':80|:443'
docker compose logs --tail=200 caddy
```

域名必须指向本机公网 IP，阿里云安全组和 UFW 都必须允许 80/443，服务器上不能有其他程序占用这些端口。

### app 一直不健康

```bash
docker compose ps
docker compose logs --tail=200 app
ls -ld data data/backups
```

如果日志出现 `permission denied`，重新执行：

```bash
chown -R 1000:1000 /data/universal-test-platform/data
docker compose restart app
```

### 修改 `.env` 后没有生效

环境变量变化需要重新创建容器：

```bash
docker compose up -d --force-recreate caddy
```

### 忘记网站密码

重新执行“生成网站密码”，更新 `.env` 中的 `BASIC_AUTH_HASH`，然后重新创建 Caddy 容器。数据库不会受影响。

## 十六、安全边界

- 不开放 3000 端口。
- 不把 `.env`、数据库或备份提交到 Git。
- SSH 22 端口尽量只允许自己的公网 IP，并优先改用 SSH 密钥。
- 网站密码必须足够长且不可复用其他重要账号密码。
- 这是统一密码，不提供多人账号、审计和细粒度权限。
- 本方案只有服务器本机备份；云盘或整台服务器损坏时可能无法恢复。

# Idenplane Helm chart

Deploys the Idenplane IAM server on Kubernetes, with an optional bundled PostgreSQL and Redis. The full guide (installation, secrets, external database, upgrades, troubleshooting) is [Kubernetes Deployment](https://github.com/idenplane/idenplane/blob/dev/docs/docs/deployment/kubernetes.mdx). Every value is described in [`values.yaml`](values.yaml) and validated by [`values.schema.json`](values.schema.json).

```bash
helm upgrade --install idenplane ./helm/idenplane \
  --namespace idenplane --create-namespace \
  --values ./helm/idenplane/values.production.yaml \
  --set env.BASE_URL="https://auth.example.com"
```

## Network policy

`networkPolicy.enabled: true` renders a `NetworkPolicy` for the Idenplane pods (off by default). It needs a CNI plugin that enforces NetworkPolicy.

| Value | Default | Meaning |
|-------|---------|---------|
| `networkPolicy.enabled` | `false` | Render the policy. |
| `networkPolicy.ingress.from` | `[]` | NetworkPolicyPeer objects allowed to reach the application port (`http`, `env.PORT`). Empty: any source. Pods of this release are always allowed. |
| `networkPolicy.ingress.extraRules` | `[]` | Additional ingress rules. |
| `networkPolicy.egress.enabled` | `true` | Restrict egress. `false`: only ingress is restricted. |
| `networkPolicy.egress.dns.enabled` | `true` | Allow DNS (UDP and TCP 53). |
| `networkPolicy.egress.dns.to` | `kube-system` namespace | Where DNS runs. Empty: port 53 to any destination. |
| `networkPolicy.egress.postgresql.port` | `5432` | Port of an external database. |
| `networkPolicy.egress.postgresql.to` | `[]` | Peers of an external database. Empty: any destination on that port. The bundled database (`postgresql.enabled`) is always selected by its labels instead. |
| `networkPolicy.egress.extraRules` | `[]` | Additional egress rules: SMTP, external identity providers, webhook targets, CAPTCHA and SMS providers, an external Redis. |

The bundled Redis (`redis.enabled`) is allowed automatically. Everything not listed is denied, so add an egress rule for each external service the server calls. Example:

```yaml
networkPolicy:
  enabled: true
  ingress:
    from:
      - namespaceSelector:
          matchLabels:
            kubernetes.io/metadata.name: ingress-nginx
  egress:
    extraRules:
      - ports:
          - protocol: TCP
            port: 443
      - ports:
          - protocol: TCP
            port: 587
```

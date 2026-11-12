{{/*
Expand the name of the chart.
*/}}
{{- define "idenplane.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this
(by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "idenplane.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart label value — used in the "helm.sh/chart" label.
*/}}
{{- define "idenplane.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "idenplane.labels" -}}
helm.sh/chart: {{ include "idenplane.chart" . }}
{{ include "idenplane.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels — used in matchLabels and Service selectors.
*/}}
{{- define "idenplane.selectorLabels" -}}
app.kubernetes.io/name: {{ include "idenplane.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use.
*/}}
{{- define "idenplane.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "idenplane.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Selector labels of a bundled dependency (postgresql, redis). The name label
differs from the application's, so the application Service and Deployment
never select these pods.
*/}}
{{- define "idenplane.componentSelectorLabels" -}}
app.kubernetes.io/name: {{ printf "%s-%s" (include "idenplane.name" .context) .component | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/instance: {{ .context.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Name of the bundled PostgreSQL Service, StatefulSet and Secret. It matches the
Bitnami sub-chart this chart used to depend on, so existing volumes are reused.
*/}}
{{- define "idenplane.postgresqlHost" -}}
{{- printf "%s-postgresql" .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Secret holding the bundled PostgreSQL password (key "password").
*/}}
{{- define "idenplane.postgresqlSecretName" -}}
{{- .Values.postgresql.auth.existingSecret | default (include "idenplane.postgresqlHost" .) }}
{{- end }}

{{/*
Name of the bundled Redis Service and StatefulSet.
*/}}
{{- define "idenplane.redisHost" -}}
{{- printf "%s-redis-master" .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Secret holding the bundled Redis password (key "redis-password").
*/}}
{{- define "idenplane.redisSecretName" -}}
{{- .Values.redis.auth.existingSecret | default (printf "%s-redis" .Release.Name | trunc 63 | trimSuffix "-") }}
{{- end }}

{{/*
Name of the Secret that holds the generated application keys.
*/}}
{{- define "idenplane.keysSecretName" -}}
{{- printf "%s-keys" (include "idenplane.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Refuse to render with placeholder or weak credentials. An empty value is fine:
the chart generates one.
*/}}
{{- define "idenplane.validateSecrets" -}}
{{- $apiKey := .Values.secrets.ADMIN_API_KEY | default "" }}
{{- if has $apiKey (list "change-me-in-production" "REPLACE_WITH_STRONG_SECRET" "changeme" "secret" "admin" "password") }}
{{- fail "secrets.ADMIN_API_KEY is a placeholder. Leave it empty to generate one, or set a random value of at least 32 characters." }}
{{- end }}
{{- if and $apiKey (lt (len $apiKey) 32) }}
{{- fail "secrets.ADMIN_API_KEY must be at least 32 characters." }}
{{- end }}
{{- $password := .Values.secrets.ADMIN_PASSWORD | default "" }}
{{- if has (lower $password) (list "admin" "password" "changeme" "change_this_password" "replace_with_strong_admin_password") }}
{{- fail "secrets.ADMIN_PASSWORD is a placeholder. Leave it empty to generate one." }}
{{- end }}
{{- if and $password (lt (len $password) 12) }}
{{- fail "secrets.ADMIN_PASSWORD must be at least 12 characters." }}
{{- end }}
{{- if and .Values.postgresql.enabled (has (.Values.postgresql.auth.password | default "") (list "REPLACE_WITH_STRONG_DB_PASSWORD")) }}
{{- fail "postgresql.auth.password is the placeholder from values.production.yaml. Leave it empty to generate one." }}
{{- end }}
{{- if and (not .Values.postgresql.enabled) (not .Values.secrets.DATABASE_URL) }}
{{- fail "postgresql.enabled is false: set secrets.DATABASE_URL to your database." }}
{{- end }}
{{- end }}

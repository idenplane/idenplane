{{/*
Expand the name of the chart.
*/}}
{{- define "authme.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this
(by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "authme.fullname" -}}
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
{{- define "authme.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "authme.labels" -}}
helm.sh/chart: {{ include "authme.chart" . }}
{{ include "authme.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels — used in matchLabels and Service selectors.
*/}}
{{- define "authme.selectorLabels" -}}
app.kubernetes.io/name: {{ include "authme.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use.
*/}}
{{- define "authme.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "authme.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Return the PostgreSQL host.
When the bundled sub-chart is enabled, derive the host from the sub-chart's
fully-qualified service name. Otherwise leave it empty so the caller must
supply DATABASE_URL directly via secrets.DATABASE_URL.
*/}}
{{- define "authme.postgresqlHost" -}}
{{- if .Values.postgresql.enabled }}
{{- printf "%s-postgresql" .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/*
Construct the DATABASE_URL from the sub-chart credentials when postgresql is
enabled and no explicit DATABASE_URL secret value has been provided.
*/}}
{{- define "authme.databaseURL" -}}
{{- if .Values.postgresql.enabled }}
{{- printf "postgresql://%s:%s@%s:5432/%s" .Values.postgresql.auth.username .Values.postgresql.auth.password (include "authme.postgresqlHost" .) .Values.postgresql.auth.database }}
{{- else }}
{{- .Values.secrets.DATABASE_URL }}
{{- end }}
{{- end }}

{{/*
Return the Redis host derived from the bundled sub-chart service name.
*/}}
{{- define "authme.redisHost" -}}
{{- if .Values.redis.enabled }}
{{- printf "%s-redis-master" .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/*
Construct the REDIS_URL from the sub-chart credentials when redis is enabled
and no explicit REDIS_URL secret value has been provided.
*/}}
{{- define "authme.redisURL" -}}
{{- if .Values.redis.enabled }}
{{- if .Values.redis.auth.enabled }}
{{- printf "redis://:%s@%s:6379" .Values.redis.auth.password (include "authme.redisHost" .) }}
{{- else }}
{{- printf "redis://%s:6379" (include "authme.redisHost" .) }}
{{- end }}
{{- else }}
{{- .Values.secrets.REDIS_URL }}
{{- end }}
{{- end }}

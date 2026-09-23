#!/usr/bin/env bash
# Generate a self-signed certificate for the myJEV TLS front door.
# (Only needed if you do NOT want Caddy's built-in internal CA.)
#
#   ./scripts/gen-certs.sh [hostname]      default: localhost
#   → certs/tls.crt + certs/tls.key
#
# Then in .env:
#   MYJEV_TLS_INTERNAL=
#   MYJEV_CERT_DIR=./certs
# and uncomment the /certs volume on the `caddy` service in docker-compose.yml.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

HOST="${1:-localhost}"
DIR="${CERT_DIR:-certs}"
DAYS="${DAYS:-825}"

mkdir -p "$DIR"

if command -v openssl >/dev/null 2>&1; then
  openssl req -x509 -newkey rsa:2048 -nodes -sha256 \
    -keyout "$DIR/tls.key" -out "$DIR/tls.crt" -days "$DAYS" \
    -subj "/CN=${HOST}/O=myJEV/OU=dev" \
    -addext "subjectAltName=DNS:${HOST},DNS:*.${HOST},IP:127.0.0.1" \
    -addext "keyUsage=digitalSignature,keyEncipherment" \
    -addext "extendedKeyUsage=serverAuth"
elif command -v python3 >/dev/null 2>&1; then
  python3 - "$DIR" "$HOST" "$DAYS" <<'PY'
import datetime, sys, subprocess
try:
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
except ImportError:
    sys.exit("neither openssl nor python-cryptography is available")
out, host, days = sys.argv[1], sys.argv[2], int(sys.argv[3])
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, host), x509.NameAttribute(NameOID.ORGANIZATION_NAME, "myJEV")])
cert = (
    x509.CertificateBuilder()
    .subject_name(name).issuer_name(name)
    .public_key(key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(datetime.datetime.utcnow() - datetime.timedelta(days=1))
    .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=days))
    .add_extension(x509.SubjectAlternativeName([x509.DNSName(host), x509.IPAddress(__import__("ipaddress").IPv4Address("127.0.0.1"))]), critical=False)
    .sign(key, hashes.SHA256())
)
open(f"{out}/tls.key", "wb").write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
open(f"{out}/tls.crt", "wb").write(cert.public_bytes(serialization.Encoding.PEM))
PY
else
  echo "Need openssl (or python3 + cryptography) to generate certificates." >&2
  exit 1
fi

chmod 600 "$DIR/tls.key" 2>/dev/null || true
echo "wrote $DIR/tls.crt and $DIR/tls.key for ${HOST} (${DAYS} days)"
echo "trust it in your OS/browser, or just accept the warning on https://${HOST}:8443"

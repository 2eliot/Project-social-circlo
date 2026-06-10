import re

# Read root .env backup
with open('/root/appchat/.env.bak', 'r') as f:
    content = f.read()

# Read private key from backend/.env
with open('/root/appchat/backend/.env', 'r') as f:
    be = f.read()

m = re.search(r'FIREBASE_PRIVATE_KEY=(.+?-----END PRIVATE KEY-----)', be, re.DOTALL)
if m:
    key = m.group(1).strip()
    oneline = key.replace('\n', '\\n')
    new_val = 'FIREBASE_PRIVATE_KEY=' + oneline
    # Replace in content (multi-line to single line)
    content = re.sub(r'FIREBASE_PRIVATE_KEY=.*', new_val, content, flags=re.DOTALL)
    with open('/root/appchat/.env', 'w') as f:
        f.write(content)
    print('OK - key converted to single line')
else:
    print('ERROR - key not found')

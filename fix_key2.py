"""Fix FIREBASE_PRIVATE_KEY in /root/appchat/.env — converts multi-line PEM to single line with \n escapes."""
import re, os

ROOT = '/root/appchat'

# 1. Extract full private key from backend/.env
with open(os.path.join(ROOT, 'backend/.env')) as f:
    be = f.read()

m = re.search(r'FIREBASE_PRIVATE_KEY=(.+?-----END PRIVATE KEY-----)', be, re.DOTALL)
if not m:
    print('ERROR: key not found in backend/.env')
    exit(1)

pk = m.group(1).strip()
oneline = pk.replace('\n', '\\n')  # Actual newlines -> literal \n

# 2. Read current root .env, strip any existing Firebase lines
with open(os.path.join(ROOT, '.env.bak')) as f:
    lines = f.readlines()

clean = []
skip = False
for line in lines:
    if line.startswith('FIREBASE_'):
        continue
    clean.append(line.rstrip('\n'))

# 3. Append Firebase vars
clean.append(f'FIREBASE_PROJECT_ID=socialcircle-bbfb3')
clean.append(f'FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@socialcircle-bbfb3.iam.gserviceaccount.com')
clean.append(f'FIREBASE_PRIVATE_KEY={oneline}')

# 4. Write
with open(os.path.join(ROOT, '.env'), 'w') as f:
    f.write('\n'.join(clean) + '\n')

# 5. Verify
with open(os.path.join(ROOT, '.env')) as f:
    new = f.read()
if '\\n' in new and '-----END PRIVATE KEY-----' in new:
    lines = new.count('\n')
    print(f'OK - {lines} lines, key has \\\\n escapes, ready for Docker')
else:
    print('WARN - may not be correct')

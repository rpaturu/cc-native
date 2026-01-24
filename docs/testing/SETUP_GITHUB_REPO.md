# Setting Up GitHub Repository for Testing

This guide shows you how to push your code to GitHub and use it with the integration test scripts.

## Step 1: Add GitHub Remote

```bash
# Add the remote (if it doesn't exist)
git remote add origin https://github.com/rpaturu/cc-native.git

# Or update existing remote
git remote set-url origin https://github.com/rpaturu/cc-native.git

# Verify
git remote -v
```

## Step 2: Push Code to GitHub

```bash
# Push main branch
git push -u origin main

# If you get authentication errors, you'll need to set up authentication (see below)
```

## Step 3: Authentication Options

### Option A: Personal Access Token (Recommended for HTTPS)

1. **Create a GitHub Personal Access Token**:
   - Go to: https://github.com/settings/tokens
   - Click "Generate new token (classic)"
   - Select scopes: `repo` (full control of private repositories)
   - Copy the token (starts with `ghp_`)

2. **Use token for pushing**:
   ```bash
   # Push with token (you'll be prompted for password - use the token)
   git push -u origin main
   
   # Or embed token in URL (less secure, but works)
   git remote set-url origin https://YOUR_TOKEN@github.com/rpaturu/cc-native.git
   git push -u origin main
   ```

3. **Use token with test scripts**:
   ```bash
   export GIT_TOKEN="ghp_your_token_here"
   ./scripts/run-phase2-integration-tests.sh \
     --repo-url https://github.com/rpaturu/cc-native.git \
     --git-token $GIT_TOKEN
   ```

### Option B: SSH Key (Recommended for SSH)

1. **Generate SSH key** (if you don't have one):
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   # Save to ~/.ssh/id_ed25519_github (or use default)
   ```

2. **Add SSH key to GitHub**:
   ```bash
   # Copy public key
   cat ~/.ssh/id_ed25519_github.pub
   # Or if using default:
   cat ~/.ssh/id_rsa.pub
   ```
   - Go to: https://github.com/settings/keys
   - Click "New SSH key"
   - Paste the public key

3. **Configure SSH**:
   ```bash
   # Add to ~/.ssh/config
   cat >> ~/.ssh/config << EOF
   Host github.com
     HostName github.com
     User git
     IdentityFile ~/.ssh/id_ed25519_github
   EOF
   ```

4. **Use SSH URL**:
   ```bash
   git remote set-url origin git@github.com:rpaturu/cc-native.git
   git push -u origin main
   ```

5. **Use SSH with test scripts**:
   ```bash
   ./scripts/run-phase2-integration-tests.sh \
     --repo-url git@github.com:rpaturu/cc-native.git \
     --git-ssh-key ~/.ssh/id_ed25519_github
   ```

## Step 4: Make Repository Private (Optional)

If you want to make the repository private:

1. Go to: https://github.com/rpaturu/cc-native/settings
2. Scroll down to "Danger Zone"
3. Click "Change visibility"
4. Select "Make private"

## Step 5: Run Tests with GitHub Repository

Your repository is now available at: **https://github.com/rpaturu/cc-native.git**

### Public Repository (No Auth Needed)
If the repository is public, you can use it directly:
```bash
./scripts/run-phase2-integration-tests.sh \
  --repo-url https://github.com/rpaturu/cc-native.git
```

### Using HTTPS with Token (Private Repo)
If the repository is private, you'll need a GitHub Personal Access Token:
```bash
# 1. Create token at: https://github.com/settings/tokens
#    - Generate new token (classic)
#    - Select 'repo' scope
#    - Copy token (starts with ghp_)

# 2. Run tests with token:
export GIT_TOKEN="ghp_your_token_here"
./scripts/run-phase2-integration-tests.sh \
  --repo-url https://github.com/rpaturu/cc-native.git \
  --git-token $GIT_TOKEN
```

### Using SSH (Private Repo)
```bash
./scripts/run-phase2-integration-tests.sh \
  --repo-url git@github.com:rpaturu/cc-native.git \
  --git-ssh-key ~/.ssh/id_ed25519_github
```

## Troubleshooting

### Authentication Failed
- **HTTPS**: Ensure token has `repo` scope
- **SSH**: Verify SSH key is added to GitHub and `ssh -T git@github.com` works

### Permission Denied
- Check repository visibility (private repos need authentication)
- Verify token/SSH key has access to the repository

### Push Rejected
- Ensure you have write access to the repository
- Check if there are any branch protection rules

## Quick Reference

```bash
# 1. Add remote
git remote add origin https://github.com/rpaturu/cc-native.git

# 2. Push code
git push -u origin main

# 3. Run tests with token
export GIT_TOKEN="ghp_xxxxx"
./scripts/run-phase2-integration-tests.sh \
  --repo-url https://github.com/rpaturu/cc-native.git \
  --git-token $GIT_TOKEN
```

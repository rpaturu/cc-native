# Deleting S3 Objects with Object Lock Enabled

## Current Configuration

Your S3 buckets were created with **Object Lock in Compliance Mode** with **7-year retention**:

```typescript
objectLockEnabled: true,
objectLockDefaultRetention: s3.ObjectLockRetention.compliance(cdk.Duration.days(2555)) // 7 years
```

**Affected Buckets:**
- `cc-native-evidence-ledger-099892828192-us-west-2`
- `cc-native-world-state-snapshots-099892828192-us-west-2`
- `cc-native-schema-registry-099892828192-us-west-2`
- `cc-native-ledger-archives-099892828192-us-west-2`

**Note:** `cc-native-artifacts-*` does NOT have Object Lock enabled.

---

## Object Lock Modes Explained

### Compliance Mode (Your Current Setup)
- **Cannot delete objects** until retention period expires (7 years)
- **Cannot change retention period** on locked objects
- **Cannot delete bucket** if it contains locked objects
- **Purpose:** Regulatory compliance, tamper-proof audit trails

### Governance Mode (Alternative)
- Can delete objects with special IAM permission: `s3:BypassGovernanceRetention`
- Can change retention period with same permission
- Still provides protection but allows authorized overrides

---

## Options for Deleting Objects

### ❌ Option 1: Wait for Retention to Expire
**Not Practical:**
- Objects locked for 7 years (2555 days)
- Cannot delete until January 2029 (if created in 2022)
- Buckets will remain and incur storage costs

### ⚠️ Option 2: Contact AWS Support (Compliance Mode Override)
**Possible but Complex:**
- AWS Support can sometimes override Compliance Mode locks
- Requires justification and may not be approved
- Typically only for:
  - Legal/regulatory requirements
  - Security incidents
  - Account closure

**Process:**
1. Open AWS Support case
2. Explain business justification
3. Provide bucket names and object keys
4. Wait for approval (may take days/weeks)
5. AWS Support performs deletion

**Note:** This is not guaranteed and AWS may refuse if no valid business case.

### ✅ Option 3: Leave Objects (Recommended for Migration)
**Best Option for Your Situation:**
- Objects are locked for compliance/audit purposes
- Since you're migrating to a new account, old data can remain
- **Cost:** ~$0.023/month per GB stored
- Empty buckets cost ~$0.023/month total

**Why This Makes Sense:**
- You're not using the old account anymore
- Data is immutable and tamper-proof (good for audit)
- Minimal ongoing cost
- No risk of accidental deletion

### 🔧 Option 4: Change to Governance Mode (If Possible)
**Only Works If:**
- Bucket was created with Governance Mode (yours is Compliance)
- OR you can change default retention mode (may not be possible)

**If Governance Mode:**
```bash
# Delete objects with bypass permission
aws s3 rm s3://bucket-name/path/to/object \
  --bypass-governance-retention \
  --profile <profile> \
  --region us-west-2
```

**Your buckets are in Compliance Mode, so this won't work.**

---

## Practical Recommendation

### For Your Migration Scenario:

**Leave the buckets and objects as-is:**

1. **Why:**
   - Object Lock was designed for compliance/audit (immutable evidence)
   - You're migrating to a new account anyway
   - Minimal cost (~$0.09/month for empty buckets)
   - No operational impact

2. **Cost Breakdown:**
   - Empty S3 bucket: ~$0.023/month
   - 5 buckets: ~$0.115/month
   - Objects stored: ~$0.023/GB/month
   - **Total: < $1/month** (likely)

3. **Benefits:**
   - Preserves audit trail (if needed for compliance)
   - No risk of data loss
   - No complex AWS Support process
   - Focus on new account setup

### If You Must Delete (AWS Support Route):

1. **Open AWS Support Case:**
   ```bash
   # Via AWS Console: Support Center > Create Case
   # Or via CLI (if you have support plan)
   ```

2. **Request Details:**
   - Subject: "Request to Override S3 Object Lock Compliance Mode for Account Migration"
   - Service: S3
   - Severity: General Guidance
   - Description:
     ```
     I need to delete S3 objects in buckets with Object Lock Compliance Mode 
     enabled due to account migration. The buckets are:
     - cc-native-evidence-ledger-099892828192-us-west-2
     - cc-native-world-state-snapshots-099892828192-us-west-2
     - cc-native-schema-registry-099892828192-us-west-2
     - cc-native-ledger-archives-099892828192-us-west-2
     
     These buckets were created for a development project that is being migrated 
     to a new AWS account. The Object Lock was set to 7-year retention, but 
     we need to clean up the old account.
     
     Business Justification: Account migration and cost optimization.
     ```

3. **Wait for Response:**
   - AWS may approve or deny
   - If approved, they will perform the deletion
   - Process may take 1-2 weeks

---

## Checking Object Lock Status

If you want to verify the Object Lock configuration:

```bash
# Get Object Lock configuration
aws s3api get-object-lock-configuration \
  --bucket cc-native-evidence-ledger-099892828192-us-west-2 \
  --profile <profile> \
  --region us-west-2

# List objects with retention
aws s3api list-objects-v2 \
  --bucket cc-native-evidence-ledger-099892828192-us-west-2 \
  --profile <profile> \
  --region us-west-2 \
  --query "Contents[?StorageClass=='GLACIER' || StorageClass=='DEEP_ARCHIVE']"
```

---

## Summary

**For your migration:**
- ✅ **Recommended:** Leave buckets/objects in old account
- ⚠️ **If needed:** Contact AWS Support (may take weeks, not guaranteed)
- ❌ **Not possible:** Direct deletion (Compliance Mode prevents it)

**Cost Impact:**
- Leaving them: ~$0.09-1/month (minimal)
- Deleting via Support: Free but time-consuming

**My Recommendation:** Leave them. Focus on setting up the new account and deploying Phase 0/1 there. The old account cleanup is essentially complete (DynamoDB deleted, stack destroyed). The S3 buckets are a minor cost that preserves your audit trail.

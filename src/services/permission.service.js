import * as permissionRepo from "../repositories/permission.repository.js";

/**
 * Role Permissions -> Member Overrides -> Final Effective Permissions
 * (report.md Phase 2.3 plan). Starts from the role's base grants, then layers
 * per-member overrides on top: `granted: true` adds a key the role doesn't
 * have, `granted: false` revokes one it does.
 */
export const getEffectivePermissions = async (businessMemberId, roleId) => {
  const [baseKeys, overrides] = await Promise.all([
    permissionRepo.listPermissionKeysForRole(roleId),
    permissionRepo.listOverridesForMember(businessMemberId),
  ]);

  const effective = new Set(baseKeys);
  for (const { key, granted } of overrides) {
    if (granted) effective.add(key);
    else effective.delete(key);
  }

  return effective;
};

export const hasPermission = async (businessMemberId, roleId, key) => {
  const effective = await getEffectivePermissions(businessMemberId, roleId);
  return effective.has(key);
};

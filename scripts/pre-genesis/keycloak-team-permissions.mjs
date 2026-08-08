export function humanAdminPermissions({ adminsGroupId, operatorsGroupId }) {
  const policies = ["console-human-admin-service-account"]
  return [
    {
      name: "console-human-admin-manage-all-users",
      policies,
      resourceType: "Users",
      scopes: ["view", "manage", "manage-group-membership"],
    },
    {
      name: "console-human-admin-manage-all-groups",
      policies,
      resourceType: "Groups",
      scopes: ["view", "view-members", "manage", "manage-membership"],
    },
    groupPermission("Admins", adminsGroupId, policies),
    groupPermission("Operators", operatorsGroupId, policies),
  ]
}

function groupPermission(name, id, policies) {
  return {
    name: `console-human-admin-manage-${name}-group`,
    policies,
    resources: [id],
    resourceType: "Groups",
    scopes: [
      "view",
      "view-members",
      "manage-members",
      "manage-membership",
      "manage-membership-of-members",
    ],
  }
}

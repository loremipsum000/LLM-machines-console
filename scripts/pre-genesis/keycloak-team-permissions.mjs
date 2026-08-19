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

export function integratedHumanAdminPermissions({
  adminsGroupId,
  operatorsGroupId,
}) {
  return humanAdminPermissions({ adminsGroupId, operatorsGroupId }).flatMap(
    (permission) => {
      if (permission.resourceType === "Users") {
        return [
          {
            ...permission,
            name: "appliance-user-administration-manage-all-users",
            policies: ["appliance-user-administration-callers"],
            scopes: permission.scopes.filter(
              (scope) => scope !== "manage-group-membership",
            ),
          },
          {
            ...permission,
            name: "console-human-admin-manage-all-user-membership",
            scopes: permission.scopes.filter(
              (scope) => scope === "manage-group-membership",
            ),
          },
        ]
      }
      if (permission.resources) {
        return [
          {
            ...permission,
            name: permission.name.replace(
              "console-human-admin-manage-",
              "appliance-user-administration-view-",
            ),
            policies: ["appliance-user-administration-callers"],
            scopes: permission.scopes.filter(
              (scope) => scope === "view" || scope === "view-members",
            ),
          },
          {
            ...permission,
            scopes: permission.scopes.filter(
              (scope) => scope !== "view" && scope !== "view-members",
            ),
          },
        ]
      }
      return [permission]
    },
  )
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

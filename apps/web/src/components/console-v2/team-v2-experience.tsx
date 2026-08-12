"use client"

import { usePendingConsoleSessionRecovery } from "@/lib/auth/pending-session-recovery"
import type { RetainedConsoleRole } from "@/lib/auth/role-claims"
import type {
  AdminTeamCsvImportPreviewResponse,
  AdminTeamGroup,
  AdminTeamGroupDetail,
  AdminTeamMember,
  AdminTeamMemberDetail,
  AdminTeamOverviewResponse,
} from "@llm-machines/contracts/inference-core"
import { ArrowLeft, Mail, Plus, RotateCcw, Shield, Trash2 } from "lucide-react"
import Link from "next/link"
import { useActionState } from "react"
import type { ReactNode } from "react"

const teamDateTimeFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeZone: "UTC",
  timeStyle: "short",
})
import {
  type TeamCsvImportActionState,
  type TeamMemberActionState,
  bulkAssignAdminTeamGroupMembersAction,
  commitAdminTeamCsvImportAction,
  createAdminTeamGroupAction,
  createAdminTeamMemberAction,
  deleteAdminTeamGroupAction,
  deleteAdminTeamMemberAction,
  disableAdminTeamMemberAction,
  generateAdminTeamPasswordAction,
  previewAdminTeamCsvImportAction,
  reactivateAdminTeamMemberAction,
  removeAdminTeamGroupMemberAction,
  sendAdminTeamInviteAction,
  sendAdminTeamPasswordResetAction,
  updateAdminTeamGroupAction,
} from "@/lib/admin/actions-core"
import { ConsoleActionToasts } from "./action-toasts"

export type TeamView =
  | "group-detail"
  | "import"
  | "manage-users"
  | "member-detail"
  | "new-group"
  | "new-member"
  | "overview"

const initialTeamActionState: TeamMemberActionState = {
  error: null,
  generatedPassword: null,
  memberId: null,
  status: "idle",
}

const initialCsvImportState: TeamCsvImportActionState = {
  commit: null,
  csv: "",
  error: null,
  preview: null,
  status: "idle",
}

export function TeamV2Experience({
  accessRole,
  detail,
  groupDetail,
  overview,
  teamAction,
  view,
}: {
  accessRole: RetainedConsoleRole
  detail?: AdminTeamMemberDetail | null
  groupDetail?: AdminTeamGroupDetail | null
  overview: AdminTeamOverviewResponse
  teamAction?: string
  view: TeamView
}) {
  const canManageTeam = accessRole === "admin"
  const visibleTeamAction = canManageTeam ? teamAction : undefined
  if (!canManageTeam && isTeamMutationView(view)) {
    return <TeamMutationAccessDenied />
  }

  if (view === "new-group") {
    return <NewGroupView />
  }

  if (view === "group-detail") {
    return (
      <GroupDetailView
        detail={groupDetail ?? null}
        canManageTeam={canManageTeam}
        members={overview.members}
        teamAction={visibleTeamAction}
      />
    )
  }

  if (view === "new-member") {
    return <NewMemberView groups={overview.groups} />
  }

  if (view === "import") {
    return <CsvImportView />
  }

  if (view === "manage-users") {
    return (
      <ManageUsersView
        canManageTeam={canManageTeam}
        members={overview.members}
        teamAction={visibleTeamAction}
      />
    )
  }

  if (view === "member-detail") {
    return (
      <MemberDetailView
        canManageTeam={canManageTeam}
        detail={detail ?? null}
        teamAction={visibleTeamAction}
      />
    )
  }

  return (
    <TeamOverviewView
      canManageTeam={canManageTeam}
      overview={overview}
      teamAction={visibleTeamAction}
    />
  )
}

function TeamMutationAccessDenied() {
  return (
    <div className="relative w-full pb-16 lg:min-h-[1024px]">
      <PageHeader title="Team" />
      <section className="mt-10 rounded-lg border border-[#353535] bg-[#232323] p-5 lg:w-[640px]">
        <h2 className="text-xl font-semibold text-white">
          Admin access required
        </h2>
        <p className="mt-2 text-sm leading-5 text-[#b2b2b2]">
          Operators can view Team identities, but only Admins can change users,
          groups, roles, or passwords.
        </p>
      </section>
    </div>
  )
}

function isTeamMutationView(view: TeamView): boolean {
  return view === "import" || view === "new-group" || view === "new-member"
}

function TeamOverviewView({
  canManageTeam,
  overview,
  teamAction,
}: {
  canManageTeam: boolean
  overview: AdminTeamOverviewResponse
  teamAction?: string
}) {
  return (
    <div className="relative w-full pb-16 lg:min-h-[1024px]">
      <PageHeader title="Team" />
      <TeamActionNotice action={teamAction} />
      <div className="mt-10 grid gap-8 lg:mt-0 lg:w-[640px] lg:pt-[148px]">
        <section
          aria-labelledby="console-v2-team-members-title"
          className="grid gap-3"
        >
          <div className="flex h-[22px] items-center justify-between">
            <h2
              className="text-lg font-semibold leading-none text-[#fdfdfd]"
              id="console-v2-team-members-title"
            >
              Members
            </h2>
            <div className="flex items-center gap-3">
              <Link
                className="flex h-5 items-center text-sm font-medium text-white transition-colors hover:text-[#d8d8d8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                href="/team/members"
              >
                {canManageTeam ? "Manage users" : "View members"}
              </Link>
              {canManageTeam ? (
                <Link
                  className="flex h-5 items-center gap-0.5 text-sm font-medium text-white transition-colors hover:text-[#d8d8d8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                  href="/team/members/new"
                >
                  <Plus aria-hidden className="size-5" />
                  Create user
                </Link>
              ) : null}
            </div>
          </div>
          <ServiceStatusBanner overview={overview} />
          <MembersTable members={overview.members} />
        </section>

        <section
          aria-labelledby="console-v2-team-groups-title"
          className="grid gap-3"
        >
          <div className="flex h-[22px] items-center justify-between">
            <h2
              className="text-lg font-semibold leading-none text-[#fdfdfd]"
              id="console-v2-team-groups-title"
            >
              Groups
            </h2>
          </div>
          <GroupsList groups={overview.groups} />
        </section>

        <section
          aria-labelledby="console-v2-team-identity-title"
          className="grid gap-3"
        >
          <h2
            className="text-lg font-semibold leading-none text-[#fdfdfd]"
            id="console-v2-team-identity-title"
          >
            {canManageTeam ? "Identity controls" : "Identity access"}
          </h2>
          <p className="text-sm leading-5 text-[#777]">
            {canManageTeam
              ? "Keycloak remains private. Manage approved users, roles, and password actions here in Console."
              : "Keycloak remains private. Operators can view approved users and roles here; only Administrators can make identity changes."}
          </p>
        </section>
      </div>
    </div>
  )
}

function NewGroupView() {
  return (
    <div className="relative w-full lg:h-[1024px]">
      <SubpageHeader title="Team > New group" />
      <BackToTeamLink />
      <section className="mt-8 lg:absolute lg:top-[164px] lg:mt-0 lg:w-[640px]">
        <form
          action={createAdminTeamGroupAction}
          className="grid gap-5 rounded-lg border border-[#353535] bg-[#232323] p-5"
        >
          <input name="returnTo" type="hidden" value="/team/groups/new" />
          <LabeledInput
            label="Group name"
            name="name"
            placeholder="Operations"
            required
          />
          <button
            className="h-12 w-fit rounded-md bg-[#2e2e2e] px-5 text-base font-semibold leading-none text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            type="submit"
          >
            Create group
          </button>
        </form>
      </section>
    </div>
  )
}

function GroupDetailView({
  canManageTeam,
  detail,
  members,
  teamAction,
}: {
  canManageTeam: boolean
  detail: AdminTeamGroupDetail | null
  members: AdminTeamMember[]
  teamAction?: string
}) {
  if (!detail) {
    return (
      <div className="relative w-full lg:h-[1024px]">
        <SubpageHeader title="Team > Group" />
        <BackToTeamLink />
        <p className="mt-20 text-base leading-6 text-[#b2b2b2]">
          This group could not be loaded from Keycloak.
        </p>
      </div>
    )
  }

  const { group } = detail
  const assignableMembers = members.filter(
    (member) =>
      !detail.members.some((groupMember) => groupMember.id === member.id),
  )

  return (
    <div className="relative w-full lg:h-[1024px]">
      <SubpageHeader title={`Team > ${group.name}`} />
      <BackToTeamLink />
      <TeamActionNotice action={teamAction} />
      <section className="mt-8 grid gap-5 lg:absolute lg:top-[164px] lg:mt-0 lg:w-[640px]">
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <div className="rounded-lg border border-[#353535] bg-[#232323] p-5">
            <h2 className="text-2xl font-semibold leading-none text-white">
              Group basics
            </h2>
            <dl className="mt-5 grid gap-4 text-sm leading-5 md:grid-cols-2">
              <DetailItem label="Name" value={group.name} />
              <DetailItem
                label="Members"
                value={group.memberCount.toString()}
              />
              <DetailItem
                label="Source"
                value={
                  group.virtual ? "Virtual Everyone group" : "Keycloak group"
                }
              />
            </dl>
          </div>
          {canManageTeam ? <GroupActions group={group} /> : null}
        </div>
        <section className="rounded-lg border border-[#353535] bg-[#232323] p-5">
          <h2 className="text-2xl font-semibold leading-none text-white">
            Members
          </h2>
          <GroupMembersTable
            canManageTeam={canManageTeam}
            group={group}
            members={detail.members}
          />
          {canManageTeam && !group.virtual ? (
            <form
              action={bulkAssignAdminTeamGroupMembersAction}
              className="mt-5 grid gap-3 rounded-md border border-[#353535] p-4"
            >
              <input name="groupId" type="hidden" value={group.id} />
              <input
                name="returnTo"
                type="hidden"
                value={`/team/groups/${group.id}`}
              />
              <p className="text-sm font-semibold leading-5 text-white">
                Bulk assign users
              </p>
              {assignableMembers.length > 0 ? (
                <div className="grid gap-2 text-sm leading-5 text-[#d9d9d9]">
                  {assignableMembers.map((member) => (
                    <label key={member.id} className="flex items-center gap-3">
                      <input
                        className="size-4 accent-[#009fff]"
                        name="memberIds"
                        type="checkbox"
                        value={member.id}
                      />
                      {member.displayName} ({member.username})
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-sm leading-5 text-[#b2b2b2]">
                  Every listed user is already in this group.
                </p>
              )}
              <button
                className="h-10 w-fit rounded-md bg-[#2e2e2e] px-4 text-sm font-semibold leading-none text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                type="submit"
              >
                Assign selected
              </button>
            </form>
          ) : null}
        </section>
      </section>
    </div>
  )
}

function CsvImportView() {
  const [previewState, previewAction, previewPending] = useActionState(
    previewAdminTeamCsvImportAction,
    initialCsvImportState,
  )
  const [commitState, commitAction, commitPending] = useActionState(
    commitAdminTeamCsvImportAction,
    initialCsvImportState,
  )
  usePendingConsoleSessionRecovery(previewPending || commitPending)
  const activeState = commitState.status !== "idle" ? commitState : previewState
  const rows = activeState.preview?.rows ?? activeState.commit?.rows ?? []
  const canCommit = Boolean(activeState.preview?.valid && activeState.csv)

  return (
    <div className="relative w-full lg:h-[1024px]">
      <SubpageHeader title="Team > CSV import" />
      <BackToTeamLink />
      <section className="mt-8 grid gap-5 lg:absolute lg:top-[164px] lg:mt-0 lg:w-[640px]">
        <form
          action={previewAction}
          className="grid gap-5 rounded-lg border border-[#353535] bg-[#232323] p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold leading-none text-white">
                Import users
              </h2>
              <p className="mt-3 max-w-[620px] text-sm leading-5 text-[#b2b2b2]">
                Upload a CSV with name, username, company email, group, role,
                invite preference, and enabled state. Preview validates every
                row before users are created in Keycloak.
              </p>
            </div>
            <Link
              className="inline-flex h-10 shrink-0 items-center rounded-md bg-[#2e2e2e] px-4 text-sm font-semibold leading-none text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
              download
              href="/team/import/template"
            >
              Download template
            </Link>
          </div>
          <label className="grid gap-2 text-sm font-medium leading-5 text-[#d9d9d9]">
            CSV file
            <input
              accept=".csv,text/csv"
              className="rounded-md border border-[#353535] bg-[#181818] px-3 py-3 text-white file:mr-4 file:rounded-md file:border-0 file:bg-[#2e2e2e] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white focus:border-[#009fff]"
              name="csvFile"
              required
              type="file"
            />
          </label>
          <button
            className="h-12 w-fit rounded-md bg-[#2e2e2e] px-5 text-base font-semibold leading-none text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            type="submit"
          >
            Preview import
          </button>
        </form>
        <CsvImportStatus state={activeState} />
        {rows.length > 0 ? (
          <section className="rounded-lg border border-[#353535] bg-[#232323] p-5">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-2xl font-semibold leading-none text-white">
                Preview rows
              </h2>
              <form action={commitAction} className="flex items-center gap-4">
                <input name="csv" type="hidden" value={activeState.csv} />
                {!canCommit ? (
                  <label className="flex items-center gap-2 text-sm font-medium leading-5 text-[#d9d9d9]">
                    <input
                      className="size-4 accent-[#009fff]"
                      name="allowPartial"
                      type="checkbox"
                    />
                    Import valid rows only
                  </label>
                ) : null}
                <button
                  className="h-10 rounded-md bg-[#2e2e2e] px-4 text-sm font-semibold leading-none text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                  type="submit"
                >
                  Commit import
                </button>
              </form>
            </div>
            <CsvImportRowsTable rows={rows} />
          </section>
        ) : null}
      </section>
    </div>
  )
}

function CsvImportStatus({ state }: { state: TeamCsvImportActionState }) {
  if (state.status === "idle") {
    return null
  }
  if (state.error) {
    return (
      <p className="rounded-md border border-[#5b2529] bg-[#371d1f] p-4 text-sm font-semibold leading-5 text-[#ff6262]">
        {state.error}
      </p>
    )
  }
  const summary =
    state.status === "committed" && state.commit
      ? `${state.commit.createdCount} created, ${state.commit.failedCount} failed, ${state.commit.skippedCount} skipped.`
      : state.preview?.valid
        ? "CSV preview is valid and ready to commit."
        : "CSV preview has row-level issues to fix."
  return (
    <p className="rounded-md border border-[#353535] bg-[#232323] p-4 text-sm font-semibold leading-5 text-white">
      {summary}
    </p>
  )
}

function CsvImportRowsTable({
  rows,
}: {
  rows: AdminTeamCsvImportPreviewResponse["rows"]
}) {
  return (
    <div className="mt-5 overflow-hidden rounded-md border border-[#353535]">
      <table className="w-full border-collapse text-left">
        <thead className="border-b border-[#353535] text-xs uppercase leading-none tracking-[0.08em] text-[#8f8f8f]">
          <tr>
            <th className="px-4 py-3 font-semibold">Line</th>
            <th className="px-4 py-3 font-semibold">Username</th>
            <th className="px-4 py-3 font-semibold">Email</th>
            <th className="px-4 py-3 font-semibold">Group</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Result</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#353535] text-sm leading-5 text-white">
          {rows.map((row) => (
            <tr key={`${row.line}-${row.username}`}>
              <td className="p-4 text-[#d9d9d9]">{row.line}</td>
              <td className="p-4">{row.username || "-"}</td>
              <td className="p-4 text-[#d9d9d9]">{row.email || "-"}</td>
              <td className="p-4 text-[#d9d9d9]">{row.group || "-"}</td>
              <td className="p-4">
                <span className="rounded-full border border-[#353535] px-3 py-1 text-xs font-semibold text-[#d9d9d9]">
                  {row.status}
                </span>
              </td>
              <td className="p-4 text-[#b2b2b2]">
                {row.errors.length > 0
                  ? row.errors.join(" ")
                  : row.actions.join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ManageUsersView({
  canManageTeam,
  members,
  teamAction,
}: {
  canManageTeam: boolean
  members: AdminTeamMember[]
  teamAction?: string
}) {
  const pageTitle = canManageTeam ? "Manage users" : "Members"

  return (
    <div className="relative w-full lg:h-[1024px]">
      <SubpageHeader title={`Team > ${pageTitle}`} />
      <BackToTeamLink />
      <TeamActionNotice action={teamAction} />
      <section className="mt-8 lg:absolute lg:top-[164px] lg:mt-0 lg:w-[860px]">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[28px] font-semibold leading-none text-white">
            {pageTitle}
          </h2>
          {canManageTeam ? (
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-md px-3 text-[22px] font-semibold leading-none text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
              href="/team/members/new"
            >
              <Plus aria-hidden className="size-6" />
              Create user
            </Link>
          ) : null}
        </div>
        <ManageUsersTable canManageTeam={canManageTeam} members={members} />
      </section>
    </div>
  )
}

function ManageUsersTable({
  canManageTeam,
  members,
}: {
  canManageTeam: boolean
  members: AdminTeamMember[]
}) {
  if (members.length === 0) {
    return (
      <div className="rounded-lg border border-[#353535] bg-[#232323] p-5 text-base leading-6 text-[#b2b2b2]">
        No Team members are available from Keycloak yet.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#353535] bg-[#232323]">
      <table className="w-full border-collapse text-left">
        <thead className="border-b border-[#353535] text-xs uppercase leading-none tracking-[0.08em] text-[#8f8f8f]">
          <tr>
            <th className="px-4 py-3 font-semibold">Name</th>
            <th className="px-4 py-3 font-semibold">Email</th>
            <th className="px-4 py-3 font-semibold">Group</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            {canManageTeam ? (
              <th className="px-4 py-3 font-semibold">Actions</th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#353535] text-sm leading-5 text-white">
          {members.map((member) => (
            <tr key={member.id}>
              <td className="p-4">
                <Link
                  className="font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                  href={`/team/members/${member.id}`}
                >
                  {member.displayName}
                </Link>
                <p className="mt-1 text-xs leading-4 text-[#8f8f8f]">
                  {member.username}
                </p>
              </td>
              <td className="p-4 text-[#d9d9d9]">{member.email}</td>
              <td className="p-4 text-[#d9d9d9]">
                {member.groups.join(", ") || "Unassigned"}
              </td>
              <td className="p-4">
                <span className="rounded-full border border-[#353535] px-3 py-1 text-xs font-semibold text-[#d9d9d9]">
                  {member.status}
                </span>
              </td>
              {canManageTeam ? (
                <td className="p-4">
                  <UserLifecycleActions
                    member={member}
                    returnTo="/team/members"
                  />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UserLifecycleActions({
  member,
  returnTo,
}: {
  member: AdminTeamMember
  returnTo: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {member.enabled ? (
        <form action={disableAdminTeamMemberAction}>
          <input name="memberId" type="hidden" value={member.id} />
          <input name="returnTo" type="hidden" value={returnTo} />
          <button
            className="h-9 rounded-md bg-[#2e2e2e] px-3 text-sm font-semibold leading-none text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            type="submit"
          >
            Disable
          </button>
        </form>
      ) : (
        <form action={reactivateAdminTeamMemberAction}>
          <input name="memberId" type="hidden" value={member.id} />
          <input name="returnTo" type="hidden" value={returnTo} />
          <button
            className="h-9 rounded-md bg-[#2e2e2e] px-3 text-sm font-semibold leading-none text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            type="submit"
          >
            Reactivate
          </button>
        </form>
      )}
      <details className="relative rounded-md border border-[#353535] px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold leading-none text-[#ff6262]">
          Delete
        </summary>
        <form action={deleteAdminTeamMemberAction} className="mt-3 grid gap-3">
          <input name="memberId" type="hidden" value={member.id} />
          <input name="returnTo" type="hidden" value={returnTo} />
          <label className="grid gap-2 text-xs font-medium leading-4 text-[#d9d9d9]">
            Type DELETE
            <input
              className="h-9 w-[140px] rounded-md border border-[#353535] bg-[#181818] px-3 text-white outline-none focus:border-[#009fff]"
              name="confirmation"
              required
            />
          </label>
          <button
            className="h-9 rounded-md bg-[#371d1f] px-3 text-sm font-semibold leading-none text-[#ff6262] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            type="submit"
          >
            Delete user
          </button>
        </form>
      </details>
    </div>
  )
}

function NewMemberView({ groups }: { groups: AdminTeamGroup[] }) {
  const [state, formAction, pending] = useActionState(
    createAdminTeamMemberAction,
    initialTeamActionState,
  )
  usePendingConsoleSessionRecovery(pending)
  const assignableGroups = realGroups(groups)

  return (
    <div className="relative w-full lg:h-[1024px]">
      <SubpageHeader title="Team > New member" />
      <BackToTeamLink />
      <section className="mt-8 lg:absolute lg:top-[164px] lg:mt-0 lg:w-[640px]">
        <form
          action={formAction}
          className="grid gap-5 rounded-lg border border-[#353535] bg-[#232323] p-5"
        >
          <input name="returnTo" type="hidden" value="/team/members/new" />
          <div className="grid gap-4 md:grid-cols-2">
            <LabeledInput
              label="Name"
              name="displayName"
              placeholder="Ada Lovelace"
              required
            />
            <LabeledInput
              label="Company email"
              name="email"
              placeholder="ada@company.com"
              required
              type="email"
            />
            <LabeledSelect label="Role" name="role">
              <option value="operator">Operator</option>
              <option value="admin">Admin</option>
            </LabeledSelect>
            <LabeledSelect defaultValue="" label="Group" name="groups" required>
              <option disabled value="">
                Select group
              </option>
              {assignableGroups.map((group) => (
                <option key={group.id} value={group.name}>
                  {group.name}
                </option>
              ))}
            </LabeledSelect>
          </div>
          <p className="text-sm leading-5 text-[#b2b2b2]">
            Username is generated from name and group, for example{" "}
            <code className="font-mono text-[#d9d9d9]">
              ada.lovelace.engineering
            </code>
            , and can be used to log in alongside the company email address.
          </p>
          {assignableGroups.length === 0 ? (
            <p className="rounded-md border border-[#5b4a20] bg-[#2c2718] px-4 py-3 text-sm font-medium leading-5 text-[#f2c94c]">
              Create a Team group before adding users.
            </p>
          ) : null}
          <div className="grid gap-3 text-sm font-medium leading-5 text-[#d9d9d9]">
            <label className="flex items-center gap-3">
              <input
                className="size-4 accent-[#009fff]"
                defaultChecked
                name="generatePassword"
                type="checkbox"
              />
              Generate non-temporary password
            </label>
            <label className="flex items-center gap-3">
              <input
                className="size-4 accent-[#009fff]"
                name="sendInvite"
                type="checkbox"
              />
              Send invite email after user creation
            </label>
          </div>
          <button
            className="h-12 w-fit rounded-md bg-[#2e2e2e] px-5 text-base font-semibold leading-none text-white disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            disabled={assignableGroups.length === 0}
            type="submit"
          >
            Create user
          </button>
          <TeamMutationResult state={state} />
        </form>
      </section>
    </div>
  )
}

function MemberDetailView({
  canManageTeam,
  detail,
  teamAction,
}: {
  canManageTeam: boolean
  detail: AdminTeamMemberDetail | null
  teamAction?: string
}) {
  if (!detail) {
    return (
      <div className="relative w-full lg:h-[1024px]">
        <SubpageHeader title="Team > Member" />
        <BackToTeamLink />
        <p className="mt-20 text-base leading-6 text-[#b2b2b2]">
          This member could not be loaded from Keycloak.
        </p>
      </div>
    )
  }

  const { member } = detail

  return (
    <div className="relative w-full lg:h-[1024px]">
      <SubpageHeader title={`Team > ${member.displayName}`} />
      <BackToTeamLink />
      <TeamActionNotice action={teamAction} />
      <section className="mt-8 grid gap-5 lg:absolute lg:top-[164px] lg:mt-0 lg:w-[640px]">
        <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
          <div className="rounded-lg border border-[#353535] bg-[#232323] p-5">
            <h2 className="text-2xl font-semibold leading-none text-white">
              Profile basics
            </h2>
            <dl className="mt-5 grid gap-4 text-sm leading-5 md:grid-cols-2">
              <DetailItem label="Name" value={member.displayName} />
              <DetailItem label="Username" value={member.username} />
              <DetailItem label="Email" value={member.email} />
              <DetailItem label="Role" value={capitalize(member.role)} />
              <DetailItem
                label="Groups"
                value={member.groups.join(", ") || "Unassigned"}
              />
              <DetailItem
                label="Status"
                value={member.enabled ? "Active" : "Disabled"}
              />
              <DetailItem
                label="Last active"
                value={formatDateTime(member.lastActiveAt)}
              />
              <DetailItem
                label="Created"
                value={formatDateTime(member.createdAt)}
              />
            </dl>
          </div>
          {canManageTeam ? <MemberActions member={member} /> : null}
        </div>
        <section className="rounded-lg border border-[#353535] bg-[#232323] p-5">
          <h2 className="text-2xl font-semibold leading-none text-white">
            Recent activity
          </h2>
          <ActivityTable rows={detail.activity} />
        </section>
      </section>
    </div>
  )
}

function MemberActions({
  member,
}: {
  member: AdminTeamMember
}) {
  const [passwordState, passwordAction, passwordPending] = useActionState(
    generateAdminTeamPasswordAction,
    initialTeamActionState,
  )
  usePendingConsoleSessionRecovery(passwordPending)
  const returnTo = `/team/members/${member.id}`

  return (
    <aside className="rounded-lg border border-[#353535] bg-[#232323] p-5">
      <h2 className="text-xl font-semibold leading-none text-white">
        Account actions
      </h2>
      <div className="mt-5 grid gap-3">
        <form action={sendAdminTeamInviteAction}>
          <input name="memberId" type="hidden" value={member.id} />
          <input name="returnTo" type="hidden" value={returnTo} />
          <ActionButton icon={<Mail aria-hidden className="size-4" />}>
            Invite by email
          </ActionButton>
        </form>
        <form action={sendAdminTeamPasswordResetAction}>
          <input name="memberId" type="hidden" value={member.id} />
          <input name="returnTo" type="hidden" value={returnTo} />
          <ActionButton icon={<RotateCcw aria-hidden className="size-4" />}>
            Reset password email
          </ActionButton>
        </form>
        <form action={passwordAction}>
          <input name="memberId" type="hidden" value={member.id} />
          <ActionButton icon={<Shield aria-hidden className="size-4" />}>
            Generate password
          </ActionButton>
        </form>
        {member.enabled ? (
          <form action={disableAdminTeamMemberAction}>
            <input name="memberId" type="hidden" value={member.id} />
            <input name="returnTo" type="hidden" value={returnTo} />
            <ActionButton>Disable user</ActionButton>
          </form>
        ) : (
          <form action={reactivateAdminTeamMemberAction}>
            <input name="memberId" type="hidden" value={member.id} />
            <input name="returnTo" type="hidden" value={returnTo} />
            <ActionButton>Reactivate user</ActionButton>
          </form>
        )}
        <details className="rounded-md border border-[#353535] p-3">
          <summary className="cursor-pointer text-sm font-semibold leading-5 text-[#ff6262]">
            Delete user
          </summary>
          <form
            action={deleteAdminTeamMemberAction}
            className="mt-3 grid gap-3"
          >
            <input name="memberId" type="hidden" value={member.id} />
            <input name="returnTo" type="hidden" value={returnTo} />
            <label className="grid gap-2 text-sm font-medium leading-5 text-[#d9d9d9]">
              Type DELETE to confirm
              <input
                className="h-10 rounded-md border border-[#353535] bg-[#181818] px-3 text-white outline-none focus:border-[#009fff]"
                name="confirmation"
                required
              />
            </label>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#371d1f] px-4 text-sm font-semibold leading-none text-[#ff6262] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
              type="submit"
            >
              <Trash2 aria-hidden className="size-4" />
              Delete
            </button>
          </form>
        </details>
      </div>
      <TeamMutationResult state={passwordState} />
    </aside>
  )
}

function MembersTable({ members }: { members: AdminTeamMember[] }) {
  if (members.length === 0) {
    return (
      <div className="rounded-lg border border-[#353535] bg-[#232323] p-5 text-base leading-6 text-[#b2b2b2]">
        No Team members are available from Keycloak yet.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#353535] bg-[#232323]">
      <table className="w-full border-collapse text-left">
        <thead className="border-b border-[#353535] text-xs uppercase leading-none tracking-[0.08em] text-[#8f8f8f]">
          <tr>
            <th className="px-4 py-3 font-semibold">Name</th>
            <th className="px-4 py-3 font-semibold">Username</th>
            <th className="px-4 py-3 font-semibold">Group</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Last active</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#353535] text-sm leading-5 text-white">
          {members.map((member) => (
            <tr key={member.id}>
              <td className="p-4">
                <Link
                  className="font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                  href={`/team/members/${member.id}`}
                >
                  {member.displayName}
                </Link>
              </td>
              <td className="p-4 text-[#d9d9d9]">{member.username}</td>
              <td className="p-4 text-[#d9d9d9]">
                {member.groups.join(", ") || "Unassigned"}
              </td>
              <td className="p-4">
                <span className="rounded-full border border-[#353535] px-3 py-1 text-xs font-semibold text-[#d9d9d9]">
                  {member.status}
                </span>
              </td>
              <td className="p-4 text-[#b2b2b2]">
                {formatDateTime(member.lastActiveAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupsList({ groups }: { groups: AdminTeamGroup[] }) {
  const visibleGroups = realGroups(groups)
  if (visibleGroups.length === 0) {
    return (
      <div className="rounded-lg border border-[#353535] bg-[#232323] p-5 text-base leading-6 text-[#b2b2b2]">
        No Team groups have been created yet.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#353535] bg-[#232323]">
      {visibleGroups.map((group, index, list) => (
        <div className="contents" key={group.id}>
          <Link
            className="grid gap-2 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            href={`/team/groups/${group.id}`}
          >
            <span className="text-base font-semibold leading-5 text-white">
              {group.name}
            </span>
            <span className="text-sm leading-5 text-[#b2b2b2]">
              {group.memberCount} members
            </span>
          </Link>
          {index < list.length - 1 ? (
            <span aria-hidden className="block h-px w-full bg-[#353535]" />
          ) : null}
        </div>
      ))}
    </div>
  )
}

function GroupActions({ group }: { group: AdminTeamGroup }) {
  if (group.virtual) {
    return (
      <aside className="rounded-lg border border-[#353535] bg-[#232323] p-5">
        <h2 className="text-xl font-semibold leading-none text-white">
          Group actions
        </h2>
        <p className="mt-4 text-sm leading-5 text-[#b2b2b2]">
          Everyone is virtual and maps to unrestricted access. It cannot be
          edited or deleted in Keycloak.
        </p>
      </aside>
    )
  }

  const returnTo = `/team/groups/${group.id}`

  return (
    <aside className="rounded-lg border border-[#353535] bg-[#232323] p-5">
      <h2 className="text-xl font-semibold leading-none text-white">
        Group actions
      </h2>
      <form action={updateAdminTeamGroupAction} className="mt-5 grid gap-3">
        <input name="groupId" type="hidden" value={group.id} />
        <input name="returnTo" type="hidden" value={returnTo} />
        <LabeledInput
          defaultValue={group.name}
          label="Group name"
          name="name"
          placeholder="Operations"
          required
        />
        <button
          className="h-10 w-fit rounded-md bg-[#2e2e2e] px-4 text-sm font-semibold leading-none text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
          type="submit"
        >
          Save group
        </button>
      </form>
      <details className="mt-5 rounded-md border border-[#353535] p-3">
        <summary className="cursor-pointer text-sm font-semibold leading-5 text-[#ff6262]">
          Delete group
        </summary>
        <form action={deleteAdminTeamGroupAction} className="mt-3 grid gap-3">
          <input name="groupId" type="hidden" value={group.id} />
          <input name="returnTo" type="hidden" value={returnTo} />
          <label className="grid gap-2 text-sm font-medium leading-5 text-[#d9d9d9]">
            Type DELETE to confirm
            <input
              className="h-10 rounded-md border border-[#353535] bg-[#181818] px-3 text-white outline-none focus:border-[#009fff]"
              name="confirmation"
              required
            />
          </label>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#371d1f] px-4 text-sm font-semibold leading-none text-[#ff6262] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
            type="submit"
          >
            <Trash2 aria-hidden className="size-4" />
            Delete
          </button>
        </form>
      </details>
    </aside>
  )
}

function GroupMembersTable({
  canManageTeam,
  group,
  members,
}: {
  canManageTeam: boolean
  group: AdminTeamGroup
  members: AdminTeamMember[]
}) {
  if (members.length === 0) {
    return (
      <p className="mt-5 text-sm leading-5 text-[#b2b2b2]">
        No users are assigned to this group yet.
      </p>
    )
  }

  return (
    <div className="mt-5 overflow-hidden rounded-md border border-[#353535]">
      <table className="w-full border-collapse text-left">
        <thead className="border-b border-[#353535] text-xs uppercase leading-none tracking-[0.08em] text-[#8f8f8f]">
          <tr>
            <th className="px-4 py-3 font-semibold">Name</th>
            <th className="px-4 py-3 font-semibold">Username</th>
            <th className="px-4 py-3 font-semibold">Role</th>
            {canManageTeam ? (
              <th className="px-4 py-3 font-semibold">Action</th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#353535] text-sm leading-5 text-white">
          {members.map((member) => (
            <tr key={member.id}>
              <td className="p-4">{member.displayName}</td>
              <td className="p-4 text-[#d9d9d9]">{member.username}</td>
              <td className="p-4 text-[#d9d9d9]">{capitalize(member.role)}</td>
              {canManageTeam ? (
                <td className="p-4">
                  {!group.virtual ? (
                    <form action={removeAdminTeamGroupMemberAction}>
                      <input name="groupId" type="hidden" value={group.id} />
                      <input name="memberId" type="hidden" value={member.id} />
                      <input
                        name="returnTo"
                        type="hidden"
                        value={`/team/groups/${group.id}`}
                      />
                      <button
                        className="rounded-md bg-[#2e2e2e] px-3 py-2 text-sm font-semibold leading-none text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
                        type="submit"
                      >
                        Remove
                      </button>
                    </form>
                  ) : (
                    <span className="text-[#8f8f8f]">Virtual</span>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ActivityTable({
  rows,
}: {
  rows: AdminTeamMemberDetail["activity"]
}) {
  if (rows.length === 0) {
    return (
      <p className="mt-5 text-sm leading-5 text-[#b2b2b2]">
        No recent activity rows are available for this member.
      </p>
    )
  }

  return (
    <div className="mt-5 overflow-hidden rounded-md border border-[#353535]">
      <table className="w-full border-collapse text-left">
        <thead className="border-b border-[#353535] text-xs uppercase leading-none tracking-[0.08em] text-[#8f8f8f]">
          <tr>
            <th className="px-4 py-3 font-semibold">Action</th>
            <th className="px-4 py-3 font-semibold">Target</th>
            <th className="px-4 py-3 font-semibold">Date/time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#353535] text-sm leading-5 text-white">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="p-4">{row.action}</td>
              <td className="p-4 text-[#d9d9d9]">
                {row.targetType} / {row.targetId}
              </td>
              <td className="p-4 text-[#b2b2b2]">
                {formatDateTime(row.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ServiceStatusBanner({
  overview,
}: {
  overview: AdminTeamOverviewResponse
}) {
  const message = serviceStatusMessage(overview.serviceStatus)
  if (!message) {
    return null
  }
  return (
    <div className="rounded-lg border border-[#353535] bg-[#232323] p-3">
      <h3 className="text-base font-semibold leading-5 text-white">
        {message.title}
      </h3>
      <p className="mt-2 text-sm leading-5 text-[#b2b2b2]">{message.detail}</p>
    </div>
  )
}

function serviceStatusMessage(
  status: AdminTeamOverviewResponse["serviceStatus"],
): { detail: string; title: string } | null {
  switch (status) {
    case "ok":
      return null
    case "not_configured":
      return {
        detail:
          "Configure the Keycloak service account before using Team identities or mutations.",
        title: "Keycloak admin API not configured",
      }
    case "unauthorized":
      return {
        detail:
          "Verify the Keycloak service-account credentials and realm-management permissions before retrying.",
        title: "Keycloak admin API authorization failed",
      }
    case "unavailable":
      return {
        detail:
          "Check Keycloak health and network reachability, then retry when the service is available.",
        title: "Keycloak admin API unavailable",
      }
    case "invalid":
      return {
        detail:
          "Check the configured realm, endpoint, and Keycloak admin API compatibility before retrying.",
        title: "Keycloak admin API response invalid",
      }
  }
}

function TeamActionNotice({ action }: { action?: string }) {
  const summary = formatTeamAction(action)
  if (!summary) {
    return null
  }
  return (
    <ConsoleActionToasts
      notifications={[
        {
          description: summary.description,
          id: `team-action-${action}`,
          title: "Team",
          tone: summary.tone,
        },
      ]}
    />
  )
}

function TeamMutationResult({ state }: { state: TeamMemberActionState }) {
  if (state.status === "idle") {
    return null
  }
  if (state.error) {
    return (
      <p className="rounded-md border border-[#371d1f] bg-[#261719] px-4 py-3 text-sm font-medium leading-5 text-[#ff6262]">
        {state.error}
      </p>
    )
  }
  return (
    <div className="rounded-md border border-[#353535] bg-[#181818] px-4 py-3 text-sm leading-5 text-[#d9d9d9]">
      <p className="font-semibold text-white">
        {state.status === "generated" ? "Password generated." : "User created."}
      </p>
      {state.generatedPassword ? (
        <label className="mt-3 grid gap-2 font-medium">
          Generated password
          <input
            className="h-10 rounded-md border border-[#353535] bg-[#101010] px-3 font-mono text-white"
            readOnly
            value={state.generatedPassword}
          />
        </label>
      ) : null}
      {state.memberId ? (
        <Link
          className="mt-3 inline-flex text-sm font-semibold text-white underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
          href={`/team/members/${state.memberId}`}
        >
          Open member detail
        </Link>
      ) : null}
    </div>
  )
}

function PageHeader({ title }: { title: string }) {
  return (
    <header className="lg:absolute lg:top-[73px]">
      <h1 className="text-2xl font-semibold leading-none text-[#fdfdfd]">
        {title}
      </h1>
    </header>
  )
}

function SubpageHeader({ title }: { title: string }) {
  const trail = title.replace(/^Team\s*>\s*/, "")
  return (
    <header className="lg:absolute lg:top-[73px]">
      <h1 className="flex items-center gap-2 text-2xl font-semibold leading-none text-[#fdfdfd]">
        <Link
          className="rounded-sm text-left transition-colors hover:text-[#d9d9d9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
          href="/team"
        >
          Team
        </Link>
        {trail && trail !== title ? (
          <span className="flex items-center gap-2">
            <span className="text-sm font-medium text-[#8b8b8b]">{">"}</span>
            <span className="text-sm font-medium text-[#fdfdfd]">{trail}</span>
          </span>
        ) : null}
      </h1>
    </header>
  )
}

function BackToTeamLink({ href = "/team" }: { href?: string }) {
  return (
    <Link
      className="mt-12 inline-flex items-center gap-2 text-sm font-semibold leading-none text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff] lg:absolute lg:top-[109px] lg:mt-0"
      href={href}
    >
      <ArrowLeft aria-hidden className="size-4" />
      Go back
    </Link>
  )
}

function LabeledInput({
  defaultValue,
  label,
  name,
  placeholder,
  required,
  type = "text",
}: {
  label: string
  defaultValue?: string
  name: string
  placeholder: string
  required?: boolean
  type?: string
}) {
  return (
    <label className="grid gap-2 text-sm font-medium leading-5 text-[#d9d9d9]">
      {label}
      <input
        className="h-11 rounded-md border border-[#353535] bg-[#181818] px-3 text-white outline-none focus:border-[#009fff]"
        defaultValue={defaultValue}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
      />
    </label>
  )
}

function LabeledSelect({
  children,
  defaultValue,
  label,
  name,
  required,
}: {
  children: ReactNode
  defaultValue?: string
  label: string
  name: string
  required?: boolean
}) {
  return (
    <label className="grid gap-2 text-sm font-medium leading-5 text-[#d9d9d9]">
      {label}
      <select
        className="h-11 rounded-md border border-[#353535] bg-[#181818] px-3 text-white outline-none focus:border-[#009fff]"
        defaultValue={defaultValue}
        name={name}
        required={required}
      >
        {children}
      </select>
    </label>
  )
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[#8f8f8f]">{label}</dt>
      <dd className="mt-1 font-semibold text-white">{value}</dd>
    </div>
  )
}

function ActionButton({
  children,
  icon,
}: {
  children: ReactNode
  icon?: ReactNode
}) {
  return (
    <button
      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[#2e2e2e] px-4 text-sm font-semibold leading-none text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#009fff]"
      type="submit"
    >
      {icon}
      {children}
    </button>
  )
}

function realGroups(groups: AdminTeamGroup[]): AdminTeamGroup[] {
  return groups.filter((group) => !group.virtual && group.name !== "Everyone")
}

function formatTeamAction(
  action?: string,
): { description: string; tone: "danger" | "success" | "warning" } | null {
  if (!action) {
    return null
  }
  const labels: Record<
    string,
    { description: string; tone: "danger" | "success" | "warning" }
  > = {
    deleteConfirmation: {
      description: "Type DELETE before deleting the user.",
      tone: "warning",
    },
    deleted: { description: "Team member deleted.", tone: "danger" },
    disabled: { description: "Team member disabled.", tone: "warning" },
    failed: { description: "Team action failed.", tone: "danger" },
    groupCreated: { description: "Team group created.", tone: "success" },
    groupDeleteConfirmation: {
      description: "Type DELETE before deleting the group.",
      tone: "warning",
    },
    groupDeleted: { description: "Team group deleted.", tone: "danger" },
    groupMemberRemoved: {
      description: "Group member removed.",
      tone: "success",
    },
    groupMembersAssigned: {
      description: "Selected users assigned to the group.",
      tone: "success",
    },
    groupUpdated: { description: "Team group updated.", tone: "success" },
    inviteSent: { description: "Invite email sent.", tone: "success" },
    missingSelection: {
      description: "Select at least one user first.",
      tone: "warning",
    },
    passwordResetSent: {
      description: "Password reset email sent.",
      tone: "success",
    },
    reactivated: { description: "Team member reactivated.", tone: "success" },
  }
  return (
    labels[action] ?? { description: "Team action completed.", tone: "success" }
  )
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "No activity"
  }
  return teamDateTimeFormatter.format(new Date(value))
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

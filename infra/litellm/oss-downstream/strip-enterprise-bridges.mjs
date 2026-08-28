#!/usr/bin/env node

import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const transformations = [
  ...[
    "llamaguard_moderations",
    "hide_secrets",
    "openai_moderations",
    "google_text_moderation",
    "llmguard_moderations",
    "blocked_user_check",
    "banned_keywords",
  ].map((callback) => ({
    file: "litellm/proxy/common_utils/callback_utils.py",
    pattern: new RegExp(
      `            elif isinstance\\(callback, str\\) and callback == "${callback}":\\n[\\s\\S]*?(?=            elif)`,
    ),
    replacement: `            elif isinstance(callback, str) and callback == "${callback}":\n                raise ValueError("${callback} is unavailable in the LLM Machines OSS downstream")\n`,
  })),
  {
    file: "litellm/integrations/custom_guardrail.py",
    pattern:
      / {20}try:\n {24}from litellm_enterprise\.integrations\.custom_guardrail import \(\n {28}EnterpriseCustomGuardrailHelper,\n {24}\)\n {20}except ImportError:\n {24}raise ImportError\([\s\S]*? {20}if result is not None:\n {24}return result\n/,
    replacement:
      '                    raise ValueError(\n                        "Tag-based guardrails are unavailable in the LLM Machines OSS downstream."\n                    )\n',
  },
  {
    file: "litellm/integrations/custom_guardrail.py",
    pattern:
      / {12}try:\n {16}from litellm_enterprise\.integrations\.custom_guardrail import \(\n {20}EnterpriseCustomGuardrailHelper,\n {16}\)\n {12}except ImportError:\n {16}raise ImportError\([\s\S]*? {12}if result is not None:\n {16}return result\n/,
    replacement:
      '            raise ValueError(\n                "Tag-based guardrails are unavailable in the LLM Machines OSS downstream."\n            )\n',
  },
  {
    file: "litellm/litellm_core_utils/custom_logger_registry.py",
    pattern:
      / {4}try:\n {8}from litellm_enterprise\.enterprise_callbacks\.pagerduty\.pagerduty import \([\s\S]*? {4}except ImportError:\n {8}pass {2}# enterprise not installed\n/,
    replacement: "",
  },
  {
    file: "litellm/litellm_core_utils/litellm_logging.py",
    pattern:
      /try:\n {4}from litellm_enterprise\.enterprise_callbacks\.callback_controls import \([\s\S]*? {4}EnterpriseStandardLoggingPayloadSetupVAR = None\n/,
    replacement:
      "GenericAPILogger = CustomLogger  # type: ignore\nResendEmailLogger = CustomLogger  # type: ignore\nSendGridEmailLogger = CustomLogger  # type: ignore\nSMTPEmailLogger = CustomLogger  # type: ignore\nPagerDutyAlerting = CustomLogger  # type: ignore\nEnterpriseCallbackControls = None  # type: ignore\nEnterpriseStandardLoggingPayloadSetupVAR = None\n",
  },
  {
    file: "litellm/proxy/guardrails/guardrail_initializers.py",
    pattern:
      /def initialize_hide_secrets\(litellm_params: LitellmParams, guardrail: Guardrail\):\n[\s\S]*? {4}return _secret_detection_object\n/,
    replacement:
      'def initialize_hide_secrets(litellm_params: LitellmParams, guardrail: Guardrail):\n    raise ValueError(\n        "Secret-detection guardrails are unavailable in the LLM Machines OSS downstream."\n    )\n',
  },
  {
    file: "litellm/proxy/hooks/__init__.py",
    pattern:
      /# Defined before the enterprise import below so that any module re-imported\n# transitively through `enterprise\.enterprise_hooks` can resolve `PROXY_HOOKS`\n# and `get_proxy_hook` from this partially-initialized module without circling\.\n/,
    replacement: "",
  },
  {
    file: "litellm/proxy/hooks/__init__.py",
    pattern:
      /### CHECK IF ENTERPRISE HOOKS ARE AVAILABLE ####\n\ntry:\n {4}from enterprise\.enterprise_hooks import ENTERPRISE_PROXY_HOOKS\nexcept ImportError:\n {4}ENTERPRISE_PROXY_HOOKS = \{\}\n/,
    replacement: "ENTERPRISE_PROXY_HOOKS = {}\n",
  },
  {
    file: "litellm/proxy/hooks/key_management_event_hooks.py",
    pattern:
      / {8}# Check v2 enterprise email loggers\n {8}try:\n {12}from litellm_enterprise\.enterprise_callbacks\.send_emails\.base_email import \([\s\S]*? {8}except ImportError:\n {12}pass\n\n/,
    replacement: "",
  },
  {
    file: "litellm/proxy/hooks/key_management_event_hooks.py",
    pattern:
      / {8}##########################\n {8}# v2 integration for emails \(enterprise\)\n {8}##########################\n {8}try:\n {12}from litellm_enterprise\.enterprise_callbacks\.send_emails\.base_email import \([\s\S]*? {8}except ImportError:\n {12}pass\n\n/,
    replacement: "",
  },
  {
    file: "litellm/proxy/hooks/key_management_event_hooks.py",
    pattern:
      / {4}@staticmethod\n {4}async def _send_key_rotated_email\(response: dict, existing_key_alias: str \| None\):\n[\s\S]*$/,
    replacement:
      '    @staticmethod\n    async def _send_key_rotated_email(response: dict, existing_key_alias: str | None):\n        verbose_proxy_logger.debug(\n            "Key-rotation email hooks are unavailable in the LLM Machines OSS downstream"\n        )\n',
  },
  {
    file: "litellm/proxy/hooks/user_management_event_hooks.py",
    pattern:
      / {8}#########################################################\n {8}########## V2 USER INVITATION EMAIL ################\n {8}#########################################################\n {8}try:\n {12}from litellm_enterprise\.enterprise_callbacks\.send_emails\.base_email import \([\s\S]*?(?= {8}#########################################################\n {8}########## LEGACY V1 USER INVITATION EMAIL)/,
    replacement: "",
  },
  {
    file: "litellm/proxy/management_endpoints/customer_endpoints.py",
    pattern:
      /async def unblock_user\(data: BlockUsers\):\n[\s\S]*?(?=\n\ndef new_budget_request)/,
    replacement:
      'async def unblock_user(data: BlockUsers):\n    raise HTTPException(\n        status_code=400,\n        detail="Blocked-user administration is unavailable in the LLM Machines OSS downstream.",\n    )\n',
  },
  {
    file: "litellm/proxy/auth/route_checks.py",
    pattern:
      / {8}try:\n {12}from litellm_enterprise\.proxy\.auth\.route_checks import EnterpriseRouteChecks\n\n {12}EnterpriseRouteChecks\.should_call_route\(route=route\)\n {8}except HTTPException as e:\n {12}raise e\n {8}except Exception:\n {12}pass\n\n/,
    replacement: "",
  },
  {
    file: "litellm/proxy/auth/user_api_key_auth.py",
    pattern:
      /try:\n {4}from litellm_enterprise\.proxy\.auth\.user_api_key_auth import \(\n {8}enterprise_custom_auth as _enterprise_custom_auth,\n {4}\)\n\n {4}enterprise_custom_auth: Callable \| None = _enterprise_custom_auth\nexcept ImportError as e:\n {4}verbose_proxy_logger\.debug\(f"Error in enterprise custom auth: \{e\}"\)\n {4}enterprise_custom_auth = None\n/,
    replacement: "enterprise_custom_auth: Callable | None = None\n",
  },
  {
    file: "litellm/proxy/management_endpoints/key_management_endpoints.py",
    pattern:
      / {4}# APPLY ENTERPRISE KEY MANAGEMENT PARAMS\n {4}try:\n {8}from litellm_enterprise\.proxy\.management_endpoints\.key_management_endpoints import \(\n {12}apply_enterprise_key_management_params,\n {8}\)\n\n {8}data = apply_enterprise_key_management_params\(data, team_table\)\n {4}except Exception as e:\n {8}verbose_proxy_logger\.debug\(\n {12}f"litellm\.proxy\.proxy_server\.generate_key_fn\(\): Enterprise key management params not applied - \{e!s\}"\n {8}\)\n\n/,
    replacement: "",
  },
  {
    file: "litellm/proxy/management_endpoints/ui_sso.py",
    pattern:
      / {4}# check if user defined a custom auth sso sign in handler, if yes, use it\n {4}if user_custom_ui_sso_sign_in_handler is not None:\n {8}try:\n {12}from litellm_enterprise\.proxy\.auth\.custom_sso_handler import \( {2}# type: ignore\[import-untyped\]\n {16}EnterpriseCustomSSOHandler,\n {12}\)\n\n {12}return await EnterpriseCustomSSOHandler\.handle_custom_ui_sso_sign_in\(\n {16}request=request,\n {12}\)\n {8}except ImportError:\n {12}raise ValueError\(\n {16}"Enterprise features are not available\. Custom UI SSO sign-in requires LiteLLM Enterprise\."\n {12}\)\n/,
    replacement:
      '    if user_custom_ui_sso_sign_in_handler is not None:\n        raise ValueError(\n            "Custom UI SSO handlers are unavailable in the LLM Machines OSS downstream."\n        )\n',
  },
  {
    file: "litellm/proxy/proxy_server.py",
    pattern:
      /# import enterprise folder\nenterprise_router = APIRouter\(\)\ntry:\n {4}# when using litellm cli\n {4}from litellm\.proxy import enterprise\nexcept Exception:\n {4}# when using litellm docker image\n {4}try:\n {8}import enterprise {2}# type: ignore\n {4}except Exception:\n {8}pass\n\n###################\n# Import enterprise routes\ntry:\n {4}from litellm_enterprise\.proxy\.enterprise_routes import router as _enterprise_router\n {4}from litellm_enterprise\.proxy\.proxy_server import EnterpriseProxyConfig\n\n {4}enterprise_router = _enterprise_router\n {4}enterprise_proxy_config: EnterpriseProxyConfig \| None = EnterpriseProxyConfig\(\)\nexcept ImportError:\n {4}enterprise_proxy_config = None\n###################\n/,
    replacement:
      "enterprise_router = APIRouter()\nenterprise_proxy_config = None\n",
  },
  {
    file: "litellm/proxy/proxy_server.py",
    pattern:
      / {8}### CHECK BATCH COST ###\n {8}if llm_router is not None and PROXY_BATCH_POLLING_ENABLED:\n[\s\S]*?(?= {8}# MEMORY LEAK FIX:)/,
    replacement: "",
  },
  {
    file: "litellm/proxy/public_endpoints/public_endpoints.py",
    pattern:
      / {4}try:\n {8}from litellm_enterprise\.proxy\.proxy_server import EnterpriseProxyConfig\n\n {8}custom_docs_description = EnterpriseProxyConfig\.get_custom_docs_description\(\)\n {4}except Exception:\n {8}custom_docs_description = None\n/,
    replacement: "    custom_docs_description = None\n",
  },
  {
    file: "litellm/proxy/response_api_endpoints/endpoints.py",
    pattern:
      / {8}# Store in managed objects table if background mode is enabled\n[\s\S]*?(?=\n {8}return response)/,
    replacement:
      '        if data.get("background"):\n            raise HTTPException(\n                status_code=400,\n                detail="Background Responses API storage is unavailable in the LLM Machines OSS downstream.",\n            )\n',
  },
  {
    file: "litellm/proxy/ui_crud_endpoints/proxy_setting_endpoints.py",
    pattern:
      /# Extension point: packages outside OSS \(e\.g\. litellm_enterprise\) can/,
    replacement:
      "# Extension point: separately admitted extension packages can",
  },
  {
    file: "litellm/proxy/utils.py",
    pattern:
      /try:\n {4}from litellm_enterprise\.enterprise_callbacks\.send_emails\.base_email import \(\n {8}BaseEmailLogger,\n {4}\)\n {4}from litellm_enterprise\.enterprise_callbacks\.send_emails\.resend_email import \(\n {8}ResendEmailLogger,\n {4}\)\n {4}from litellm_enterprise\.enterprise_callbacks\.send_emails\.sendgrid_email import \(\n {8}SendGridEmailLogger,\n {4}\)\n {4}from litellm_enterprise\.enterprise_callbacks\.send_emails\.smtp_email import \(\n {8}SMTPEmailLogger,\n {4}\)\nexcept ImportError:\n {4}BaseEmailLogger = None {2}# type: ignore\n {4}SendGridEmailLogger = None {2}# type: ignore\n {4}SMTPEmailLogger = None {2}# type: ignore\n {4}ResendEmailLogger = None {2}# type: ignore\n/,
    replacement:
      "BaseEmailLogger = None  # type: ignore\nSendGridEmailLogger = None  # type: ignore\nSMTPEmailLogger = None  # type: ignore\nResendEmailLogger = None  # type: ignore\n",
  },
]

export function stripEnterpriseBridges(sourceRoot) {
  for (const { file, pattern, replacement } of transformations) {
    const absolute = path.join(sourceRoot, file)
    const source = readFileSync(absolute, "utf8")
    const matches = source.match(pattern)
    if (!matches || matches.length !== 1) {
      throw new Error(`expected one Enterprise bridge in ${file}`)
    }
    writeFileSync(absolute, source.replace(pattern, replacement))
  }

  const remaining = []
  for (const file of walkPython(sourceRoot)) {
    const source = readFileSync(file, "utf8")
    if (/litellm_enterprise|enterprise\.enterprise_hooks/.test(source)) {
      remaining.push(path.relative(sourceRoot, file))
    }
  }
  if (remaining.length > 0) {
    throw new Error(
      `Enterprise import bridges survived sanitization: ${remaining.join(", ")}`,
    )
  }
}

function walkPython(root) {
  const files = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile() && entry.name.endsWith(".py"))
        files.push(absolute)
    }
  }
  visit(root)
  return files
}

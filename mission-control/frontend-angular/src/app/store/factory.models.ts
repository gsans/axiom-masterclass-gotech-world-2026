/**
 * Domain Types & Constants for the Axiom Mission Control NgRx Store (`factoryFeature`).
 */

export interface WorktreeData {
  target_repo: string;
  worktree_path: string;
  branch_name: string;
  base_commit: string;
}

export interface ElicitationState {
  status: 'IDLE' | 'WAITING_FOR_SIGNAL' | 'RESOLVED';
  question: string | null;
  toolCallId: string | null;
  resolution: {
    decision: string;
    source: string;
    notes: string;
  } | null;
}

export interface OracleCheck {
  id: string;
  name: string;
  status: 'PASS' | 'FAIL';
  detail: string;
}

export interface DeterministicOraclesReport {
  passed: boolean;
  passedCount: number;
  totalCount: number;
  elapsedMs: number;
  evidenceHash: string;
  checks: OracleCheck[];
  violations: string[];
  codePointer: string;
}

export interface VerificationReport {
  verdict: 'PASS' | 'WARN' | 'FAIL' | 'BLOCKED_BY_ORACLE' | 'DEFERRED';
  provider: string;
  gatewayMode?: string;
  model: string;
  score: number;
  summary: string;
  findings: string[];
  deterministicOracles?: DeterministicOraclesReport;
  codePointer?: string;
}

export interface TokenWeather {
  zone: string;
  tokensUsed: number;
  smartZoneLimit: number;
  saturationLimit: number;
  estimatedUsd: number;
  hardBudgetUsd: number;
}

export interface BoundaryRule {
  id: string;
  description: string;
  pattern: string;
  scope: string;
  state: 'SOFT_TRIPWIRE' | 'HARD_LOCK' | 'APPROVED_EXCEPTION';
  owner_role: string;
}

export interface TrustedSkill {
  id: string;
  slug: string;
  path: string;
  tier: string;
  promoted_from_run: string;
  status: string;
}

export interface FencesLedger {
  mandate: {
    id: string;
    title: string;
    approved_by: string;
    token_budget_usd: number;
    burn_usd: number;
  };
  active_shift: string;
  active_lens: string;
  boundary_rules: BoundaryRule[];
  trusted_skills?: TrustedSkill[];
}

export interface FactorySnapshot {
  runId: string;
  threadId: string;
  phase: string;
  targetRepo: string;
  mainTreeCleanBefore: boolean;
  mainTreeCleanAfter: boolean;
  worktree: WorktreeData | null;
  elicitation: ElicitationState;
  workerMode: string;
  gatewayMode: string;
  sponsorPreset: string;
  chaosMode?: string | null;
  fencesLedger?: FencesLedger;
  tokenWeather?: TokenWeather;
  diff: string;
  verification: VerificationReport | null;
  logs: Array<{ ts: string; text: string }>;
}

export interface ToolboxConfig {
  stageUnlock: boolean;
  features: {
    deterministicOracles: boolean;
    gatewaySwitch: boolean;
    sponsorChassis: boolean;
    redteamChaos: boolean;
    tokenWeather: boolean;
  };
  gatewayMode: string;
  sponsorPreset: string;
  hardBudgetUsd: number;
  activeModels?: { worker: string; reviewer: string };
  fencesLedger?: FencesLedger;
  pxpipeProxy?: {
    enabled: boolean;
    localProxyUrl: string;
    airgapTunnelNode: string;
    agentKeyVaulting: string;
  };
  lastGatewayNotice: string | null;
  codePointers: Record<string, string>;
}

export interface InboxItem {
  id: string;
  code: string;
  title: string;
  branch: string;
  shift: 'DAY_SHIFT' | 'NIGHT_SHIFT';
  status: 'WAITING_FOR_SIGNAL' | 'RUNNING' | 'PASS' | 'BLOCKED_BY_ORACLE' | 'QUEUED';
  score?: number;
  hash?: string;
  updatedAt: string;
  summary?: string;
  diffPreview?: string;
}

export type ActiveWorkspaceTab =
  | 'OVERVIEW_ELICITATION'
  | 'AGUI_CHAT'
  | 'WHITEBOARD_TO_PR'
  | 'VERIFICATION_DIFF'
  | 'FENCES_SKILLS'
  | 'EVENT_STREAM';

export interface AgUiStepPill {
  name: string;
  label: string;
  status: 'RUNNING' | 'FINISHED';
}

export interface AgUiChatTurn {
  id: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: string;
  text: string;
  runId?: string;
  shiftCode?: string;
  interactionId?: string;
  model?: string;
  steps?: AgUiStepPill[];
  toolCall?: {
    id: string;
    name: string;
    status: 'WAITING_FOR_SIGNAL' | 'RESOLVED';
    question?: string | null;
    targetFile?: string | null;
    resolution?: {
      decision: string;
      source: string;
      notes: string;
    } | null;
  };
  snapshot?: FactorySnapshot | null;
  whiteboardPlan?: WhiteboardSynthesisPlan | null;
}

export interface WhiteboardSynthesisPlan {
  status: string;
  simulated?: boolean;
  source: string;
  interactionId?: string;
  model?: string;
  diagramTitle: string;
  detectedComponents: string[];
  detectedFlows: string[];
  targetFile: string;
  taskPrompt: string;
  prTitle: string;
}

export const SPONSOR_PRESET_LABELS: Record<
  string,
  { badge: string; station2: string; station3: string; station4: string }
> = {
  DEFAULT_CLAUDE_CODEX: {
    badge: 'Claude Code + OpenAI Codex',
    station2: 'Isolated worker · git worktree',
    station3: 'Approvals · MCP elicitation (needs input)',
    station4: 'Checking the work: checks, then independent reviewer',
  },
  COGNITION_DEVIN: {
    badge: 'Cognition Track (Devin + Devin Review)',
    station2: 'Station 1 · Devin Isolated Worktree Sandbox',
    station3: 'Station 2 · Devin Human-in-the-Loop Elicitation Gate',
    station4: 'Station 3 · Devin Review Adversarial PR Gate',
  },
  TESSL_SPEC: {
    badge: 'Tessl Track (Spec-Driven Context Engine)',
    station2: 'Station 1 · Tessl Spec-to-Worktree Lane',
    station3: 'Station 2 · Tessl Spec Ambiguity Elicitation Gate',
    station4: 'Station 3 · Tessl Deterministic Spec & Diff Verifier',
  },
  COHERE_ENTERPRISE: {
    badge: 'Cohere Enterprise (Command-A Compliance)',
    station2: 'Station 1 · Enterprise Isolated Git Worktree',
    station3: 'Station 2 · Policy Governance Approval Gate (MCP)',
    station4: 'Station 3 · Cohere Command-A Enterprise Diff Verifier',
  },
  PIPECAT_AGUI: {
    badge: 'Daily Pipecat + CopilotKit AG-UI',
    station2: 'Station 1 · Pipecat Dispatched Git Worktree',
    station3: 'Station 2 · Pipecat Voice Barge-In Elicitation Gate',
    station4: 'Station 3 · AG-UI Streaming Diff & Oracle Verifier',
  },
};

export const INBOX_SECTIONS: { key: string; label: string; statuses: InboxItem['status'][] }[] = [
  { key: 'input', label: 'Needs input', statuses: ['WAITING_FOR_SIGNAL'] },
  { key: 'working', label: 'Working', statuses: ['RUNNING', 'QUEUED'] },
  { key: 'review', label: 'Ready for review', statuses: ['PASS'] },
  { key: 'resolved', label: 'Resolved', statuses: ['BLOCKED_BY_ORACLE'] },
];

export const INITIAL_NIGHT_SHIFT_INBOX: InboxItem[] = [
  {
    id: 'ns-302',
    code: 'AXM-302',
    title: 'Backfill unit tests for token weather budget guard',
    branch: 'factory/ns-302-builder',
    shift: 'NIGHT_SHIFT',
    status: 'PASS',
    score: 97,
    hash: 'sha256:57034ee6',
    updatedAt: '04:12 AM',
    summary:
      'Night-Shift local worker backfilled 4 unit assertions for token budget guard within hardened FENCE-001/FENCE-002 boundaries.',
    diffPreview: `diff --git a/tests/test_token_weather.py b/tests/test_token_weather.py
new file mode 100644
--- /dev/null
+++ b/tests/test_token_weather.py
@@ -0,0 +1,12 @@
+def test_smart_zone_alert_threshold():
+    assert compute_zone(4200) == "FRESH_WINDOW"
+    assert compute_zone(155000) == "SATURATION_ALERT"`,
  },
  {
    id: 'ns-301',
    code: 'AXM-301',
    title: 'Quarantine untrusted webhook hook in compromised_hook.py',
    branch: 'factory/ns-301-builder',
    shift: 'NIGHT_SHIFT',
    status: 'BLOCKED_BY_ORACLE',
    score: 10,
    hash: 'sha256:7726e3fa',
    updatedAt: '02:48 AM',
    summary:
      'Blocked at Stage 1 Deterministic AST & Secret Oracle (0 LLM tokens spent): detected banned eval() and AWS key pattern.',
    diffPreview: `diff --git a/compromised_hook.py b/compromised_hook.py
new file mode 100644
--- /dev/null
+++ b/compromised_hook.py
@@ -0,0 +1,3 @@
+# BLOCKED BY STAGE-1 ORACLE
+AWS_KEY = "AKIAIOSFODNN7EXAMPLE"
+eval("__import__('os').system('echo pwned')")`,
  },
];

export const DEFAULT_BOUNDARY_RULES: BoundaryRule[] = [
  {
    id: 'FENCE-001',
    description: 'No external process execution in web client',
    pattern: 'child_process|spawn|execSync|eval\\(',
    scope: 'src/ui/**',
    state: 'SOFT_TRIPWIRE',
    owner_role: 'SEC_OPS',
  },
  {
    id: 'FENCE-002',
    description: 'Immutable Auth Session Contract',
    pattern: 'export interface AuthSession',
    scope: 'src/core/auth.ts',
    state: 'HARD_LOCK',
    owner_role: 'ARCH_LEAD',
  },
];

export const DEFAULT_TRUSTED_SKILLS: TrustedSkill[] = [
  {
    id: 'SKILL-001',
    slug: 'pci-checkout-slice',
    path: '.claude/skills/pci-checkout-slice/SKILL.md',
    tier: 'LAYER_1_TRUSTED',
    promoted_from_run: 'seed',
    status: 'ACTIVE',
  },
];

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Heart, Sparkles, Image as ImageIcon, Clock, Zap, Package } from 'lucide-react';

// ── 类型 ──────────────────────────────────────────────────────────────────────

interface ModelPref {
  model: string;
  score: number;
  useCount: number;
  favoriteCount: number;
  nickname: string;
  category: string;
  thumbnail: string | null;
  triggerWords: string;
}

interface LoraPref extends ModelPref {
  avgStrength: number;
}

interface UsageStats {
  totalGenerations: number;
  totalFavorites: number;
  tab7Count: number;
  tab9Count: number;
  lastActiveTime: number;
}

interface ParamPreferences {
  preferredSize: { width: number; height: number };
  preferredSteps: number;
  preferredCfg: number;
  preferredSampler: string;
  preferredScheduler: string;
}

interface StyleFeature {
  tag: string;
  count: number;
}

interface FrequentCombination {
  count: number;
  model: { key: string; nickname: string; category: string; thumbnail: string | null };
  loras: Array<{ key: string; nickname: string; category: string; thumbnail: string | null }>;
}

interface ProfileView {
  usageStats: UsageStats;
  paramPreferences: ParamPreferences;
  styleFeatures: StyleFeature[];
  modelPreferences: ModelPref[];
  loraPreferences: LoraPref[];
  frequentCombinations: FrequentCombination[];
}

// ── 样式 ──────────────────────────────────────────────────────────────────────

const blockTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--color-text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginTop: 28,
  marginBottom: 14,
};

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '12px 14px',
  background: 'var(--color-bg)',
};

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px',
  border: '1px solid var(--color-border)',
  borderRadius: 12,
  fontSize: 11,
  color: 'var(--color-text-secondary)',
  background: 'var(--color-bg)',
};

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function formatLastActive(ts: number): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(ts).toLocaleDateString();
}

// 按类别对 LoRA 分组
const LORA_GROUP_ORDER = ['角色', '姿势', '表情', '风格', '其他'];
function groupLoras(loras: LoraPref[]): Record<string, LoraPref[]> {
  const groups: Record<string, LoraPref[]> = {};
  for (const lp of loras) {
    const cat = LORA_GROUP_ORDER.includes(lp.category) ? lp.category : '其他';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(lp);
  }
  return groups;
}

// ── 子组件：统计卡 ───────────────────────────────────────────────────────────

function StatCard({ icon, label, value, hint }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div style={{ ...cardStyle, flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-text-secondary)', fontSize: 11, marginBottom: 6 }}>
        {icon}
        <span>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.1 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

// ── 子组件：模型进度条行 ────────────────────────────────────────────────────

function ModelBarRow({ mp, maxScore }: { mp: ModelPref; maxScore: number }) {
  const pct = maxScore > 0 ? (mp.score / maxScore) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
      <div style={{ flex: '0 0 38%', fontSize: 12, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={mp.nickname}>
        {mp.nickname}
      </div>
      <div style={{ flex: 1, height: 6, background: 'var(--color-border)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-primary)', borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--color-text-secondary)' }}>
        <span title="使用次数">{mp.useCount}</span>
        {mp.favoriteCount > 0 && (
          <span title="收藏次数" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: '#ef4444' }}>
            <Heart size={11} fill="#ef4444" /> {mp.favoriteCount}
          </span>
        )}
      </div>
    </div>
  );
}

// ── 子组件：LoRA 小卡 ───────────────────────────────────────────────────────

function LoraChip({ lp }: { lp: LoraPref }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        background: 'var(--color-bg)',
        minWidth: 0,
      }}
      title={`${lp.nickname} · 使用 ${lp.useCount} 次 · 收藏 ${lp.favoriteCount} 次 · 平均强度 ${lp.avgStrength}`}
    >
      {lp.thumbnail ? (
        <img
          src={`/model_meta/thumbnails/${lp.thumbnail}`}
          alt=""
          style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <div style={{ width: 28, height: 28, borderRadius: 4, background: 'var(--color-border)', flexShrink: 0 }} />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {lp.nickname}
        </div>
        <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginTop: 2, display: 'flex', gap: 6 }}>
          <span>×{lp.useCount}</span>
          {lp.favoriteCount > 0 && (
            <span style={{ color: '#ef4444', display: 'inline-flex', alignItems: 'center', gap: 1 }}>
              <Heart size={9} fill="#ef4444" />{lp.favoriteCount}
            </span>
          )}
          <span>@{lp.avgStrength}</span>
        </div>
      </div>
    </div>
  );
}

// ── 主组件 ───────────────────────────────────────────────────────────────────

export function MyProfileSection() {
  const [data, setData] = useState<ProfileView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/user-profile-view');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loraGroups = useMemo(() => (data ? groupLoras(data.loraPreferences) : {}), [data]);
  const topModels = useMemo(() => (data ? data.modelPreferences.slice(0, 8) : []), [data]);
  const maxModelScore = useMemo(() => (topModels[0]?.score ?? 0), [topModels]);
  const maxTagCount = useMemo(() => (data?.styleFeatures[0]?.count ?? 1), [data]);

  // 空状态
  const isEmpty = data && data.usageStats.totalGenerations === 0;

  return (
    <div style={{ marginBottom: 32 }}>
      {/* 头部：标题 + 刷新 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>我的偏好</h3>
        <button
          onClick={load}
          disabled={loading}
          title="重新聚合"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '5px 10px',
            fontSize: 12,
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            background: 'var(--color-bg)',
            color: 'var(--color-text-secondary)',
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : undefined }} />
          {loading ? '加载中' : '刷新'}
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
        基于你所有会话的生成历史和收藏聚合。用于 AI 助手的个性化推荐。
      </div>

      {error && (
        <div style={{ ...cardStyle, marginTop: 16, color: '#ef4444', fontSize: 12 }}>
          加载失败：{error}
        </div>
      )}

      {isEmpty && (
        <div style={{ ...cardStyle, marginTop: 16, textAlign: 'center', padding: '40px 20px', color: 'var(--color-text-secondary)', fontSize: 13 }}>
          <Sparkles size={28} style={{ opacity: 0.5, marginBottom: 8 }} />
          <div>还没有生成记录。</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>在 ZIT快出 或 文生图 Tab 生成几张图后，这里会出现你的画像。</div>
        </div>
      )}

      {data && !isEmpty && (
        <>
          {/* 使用概况 */}
          <div style={blockTitleStyle}>使用概况</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <StatCard icon={<ImageIcon size={12} />} label="总生成数" value={data.usageStats.totalGenerations} />
            <StatCard icon={<Heart size={12} />} label="总收藏数" value={data.usageStats.totalFavorites} />
            <StatCard icon={<Zap size={12} />} label="快速出图" value={data.usageStats.tab7Count} hint={`ZIT ${data.usageStats.tab9Count}`} />
            <StatCard icon={<Clock size={12} />} label="最后活跃" value={formatLastActive(data.usageStats.lastActiveTime)} />
          </div>

          {/* Top 模型 */}
          {topModels.length > 0 && (
            <>
              <div style={blockTitleStyle}>常用基础模型 Top {topModels.length}</div>
              <div style={cardStyle}>
                {topModels.map((mp) => (
                  <ModelBarRow key={mp.model} mp={mp} maxScore={maxModelScore} />
                ))}
              </div>
            </>
          )}

          {/* Top LoRA by category */}
          {data.loraPreferences.length > 0 && (
            <>
              <div style={blockTitleStyle}>LoRA 偏好（按分类）</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {LORA_GROUP_ORDER.filter((c) => loraGroups[c]?.length).map((cat) => (
                  <div key={cat}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text)', marginBottom: 6 }}>
                      {cat} <span style={{ color: 'var(--color-text-secondary)', fontWeight: 400 }}>({loraGroups[cat].length})</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
                      {loraGroups[cat].slice(0, 6).map((lp) => (
                        <LoraChip key={lp.model} lp={lp} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* 参数偏好 */}
          {(data.paramPreferences.preferredSize.width > 0 || data.paramPreferences.preferredSteps > 0) && (
            <>
              <div style={blockTitleStyle}>参数偏好（众数）</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {data.paramPreferences.preferredSize.width > 0 && (
                  <StatCard icon={<Package size={12} />} label="尺寸" value={`${data.paramPreferences.preferredSize.width}×${data.paramPreferences.preferredSize.height}`} />
                )}
                {data.paramPreferences.preferredSteps > 0 && (
                  <StatCard icon={<Package size={12} />} label="步数" value={data.paramPreferences.preferredSteps} />
                )}
                {data.paramPreferences.preferredCfg > 0 && (
                  <StatCard icon={<Package size={12} />} label="CFG" value={data.paramPreferences.preferredCfg} />
                )}
                {data.paramPreferences.preferredSampler && (
                  <StatCard icon={<Package size={12} />} label="采样器" value={data.paramPreferences.preferredSampler} />
                )}
                {data.paramPreferences.preferredScheduler && (
                  <StatCard icon={<Package size={12} />} label="调度器" value={data.paramPreferences.preferredScheduler} />
                )}
              </div>
            </>
          )}

          {/* 风格标签云 */}
          {data.styleFeatures.length > 0 && (
            <>
              <div style={blockTitleStyle}>提示词高频标签 Top {Math.min(data.styleFeatures.length, 30)}</div>
              <div style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {data.styleFeatures.slice(0, 30).map((sf) => {
                  const weight = sf.count / maxTagCount;
                  const fontSize = 10 + Math.round(weight * 6); // 10–16
                  return (
                    <span
                      key={sf.tag}
                      style={{
                        ...chipStyle,
                        fontSize,
                        color: weight > 0.5 ? 'var(--color-text)' : 'var(--color-text-secondary)',
                        fontWeight: weight > 0.7 ? 600 : 400,
                      }}
                      title={`出现 ${sf.count} 次`}
                    >
                      {sf.tag}
                      <span style={{ opacity: 0.55, fontSize: fontSize - 2 }}>×{sf.count}</span>
                    </span>
                  );
                })}
              </div>
            </>
          )}

          {/* 常用组合 */}
          {data.frequentCombinations.length > 0 && (
            <>
              <div style={blockTitleStyle}>常用组合 Top {data.frequentCombinations.length}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.frequentCombinations.map((combo, i) => (
                  <div key={i} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      flex: '0 0 auto',
                      width: 28, height: 28, borderRadius: 14,
                      background: 'var(--color-primary)',
                      color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 600,
                    }}>{i + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--color-text)', marginBottom: 4 }}>
                        <span style={{ color: 'var(--color-text-secondary)' }}>模型：</span>
                        {combo.model.nickname}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {combo.loras.length === 0 ? (
                          <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>（无 LoRA）</span>
                        ) : combo.loras.map((l) => (
                          <span key={l.key} style={chipStyle}>{l.nickname}</span>
                        ))}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                      使用 {combo.count} 次
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

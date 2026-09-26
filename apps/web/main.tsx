import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Action, ActorObservation } from "../../packages/contracts";
import type { DebugSnapshot } from "../../packages/sim/debug";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/700.css";
import { persist, restore } from "./storage";
import "./style.css";
const E1Debug = React.lazy(() => import("./e1-debug"));
const E1V2Debug = React.lazy(() => import("./e1-v2-debug"));
const A1Debug = React.lazy(() => import("./a1-debug"));
const IndividualDebug = React.lazy(() => import("./individual-debug"));
const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});
const names: Record<string, string> = {
  a: "アウル",
  b: "ベル",
  hearth: "故郷の義務",
  honor: "奉仕の名誉",
  contract: "契約の権利",
  active: "有効",
  proposed: "伝達中",
  fulfilled: "履行",
  breached: "違反",
  void: "失効",
};
const time = (n: number) =>
  `${Math.floor(n / 1440)}日 ${String(Math.floor((n % 1440) / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
function Map({
  o,
  select,
  battle = false,
}: {
  o: ActorObservation;
  select: (s: string) => void;
  battle?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    const mapText =
      o.settlements.map((s) => s.name).join("") +
      "西の平野鷹爪山脈報告兵数アウルベル推定";
    void Promise.all([
      document.fonts.load('400 14px "Noto Sans JP"', mapText),
      document.fonts.load('700 18px "Noto Sans JP"', mapText),
    ]).then(() => {
      if (cancelled) return;
      const canvas = ref.current!,
        ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, 960, 520);
      ctx.fillStyle = "#1e3430";
      ctx.fillRect(0, 0, 960, 520);
      if (battle && o.battles.length) {
        const b = o.battles.at(-1)!;
        const colors: Record<string, string> = {
          plain: "#415344",
          forest: "#254c37",
          river: "#426f85",
          bridge: "#b99c67",
          highland: "#7c7960",
        };
        for (let i = 0; i < b.terrain.length; i++) {
          ctx.fillStyle = colors[b.terrain[i]];
          ctx.fillRect(224 + (i % 64) * 8, 4 + Math.floor(i / 64) * 8, 8, 8);
        }
        for (const u of o.units.filter((u) => b.units.includes(u.id))) {
          ctx.fillStyle = u.factionId === "a" ? "#e5c278" : "#e38b76";
          ctx.fillRect(224 + u.x * 8, u.y * 8, 10, 10);
          ctx.font = '14px "Noto Sans JP", sans-serif';
          ctx.fillText(
            `${names[u.factionId]} ${u.memberIds.length}`,
            238 + u.x * 8,
            u.y * 8,
          );
        }
        for (const c of o.contacts.filter((c) => b.units.includes(c.unitId))) {
          ctx.fillStyle = "#e38b76";
          ctx.fillRect(224 + c.x * 8, c.y * 8, 10, 10);
          ctx.font = '14px "Noto Sans JP"';
          ctx.fillText(`敵 ${c.min}〜${c.max}`, 238 + c.x * 8, c.y * 8 + 14);
        }
        return;
      }
      ctx.strokeStyle = "#71826a";
      ctx.lineWidth = 4;
      const roads = [
        ["capital", "farm"],
        ["capital", "trade"],
        ["farm", "trade"],
        ["trade", "pass"],
        ["farm", "pass"],
        ["pass", "enemy"],
      ];
      for (const [a, b] of roads) {
        const from = o.settlements.find((s) => s.id === a)!,
          to = o.settlements.find((s) => s.id === b)!;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
      ctx.fillStyle = "#304c40";
      for (let i = 0; i < 23; i++) {
        const x = 470 + (i % 5) * 60,
          y = 60 + Math.floor(i / 5) * 90;
        ctx.beginPath();
        ctx.moveTo(x, y + 50);
        ctx.lineTo(x + 28, y);
        ctx.lineTo(x + 58, y + 50);
        ctx.fill();
      }
      ctx.font = '13px "Noto Sans JP", sans-serif';
      ctx.fillStyle = "#a5b39d";
      ctx.fillText("西の平野", 110, 85);
      ctx.fillText("鷹爪山脈", 535, 70);
      ctx.fillText(
        o.contacts.length
          ? "敵軍は報告時点の推定。現在位置とは限りません。"
          : "報告に基づく地図 · 敵軍の位置は未確認",
        280,
        480,
      );
      for (const s of o.settlements) {
        ctx.fillStyle = s.factionId === "a" ? "#e5c278" : "#d28e7b";
        ctx.beginPath();
        ctx.arc(s.x, s.y, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff2d9";
        ctx.font = 'bold 18px "Noto Sans JP", sans-serif';
        ctx.fillText(s.name, s.x - 40, s.y - 26);
        ctx.font = '12px "Noto Sans JP", sans-serif';
        ctx.fillText(names[s.factionId], s.x - 15, s.y + 31);
        const n = o.units
          .filter((u) => u.location === s.id)
          .reduce((v, u) => v + u.memberIds.length, 0);
        if (n) ctx.fillText(`⚑ 報告兵数 ${n}`, s.x - 38, s.y + 53);
        const enemy = o.contacts.filter((c) => c.location === s.id);
        if (enemy.length) {
          ctx.fillStyle = "#efb099";
          ctx.fillText(
            `敵の推定 ${enemy.reduce((v, c) => v + c.min, 0)}〜${enemy.reduce((v, c) => v + c.max, 0)}`,
            s.x - 40,
            s.y + 72,
          );
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [o, battle]);
  return (
    <canvas
      ref={ref}
      width={960}
      height={520}
      aria-label={battle ? "報告された会戦地図" : "戦略地図：拠点を選択"}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect(),
          x = ((e.clientX - r.left) / r.width) * 960,
          y = ((e.clientY - r.top) / r.height) * 520;
        const s = o.settlements.find((s) => Math.hypot(s.x - x, s.y - y) < 65);
        if (s) select(s.id);
      }}
    />
  );
}
function App() {
  const [o, setO] = useState<ActorObservation>();
  const [seed, setSeed] = useState(240924);
  const [started, setStarted] = useState(false);
  const [tab, setTab] = useState("地図");
  const [devMode, setDevMode] = useState(false);
  const [debug, setDebug] = useState<DebugSnapshot>();
  const [debugQuery, setDebugQuery] = useState("");
  const [debugPerson, setDebugPerson] = useState("a_0005");
  const [debugOffset, setDebugOffset] = useState(0);
  const [audienceMode, setAudienceMode] = useState<"summon" | "visit">(
    "summon",
  );
  const [place, setPlace] = useState("capital");
  const [person, setPerson] = useState("a_0002");
  const [unit, setUnit] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(true);
  const [query, setQuery] = useState("");
  const [amount, setAmount] = useState(3000);
  const [reward, setReward] = useState(40);
  const [due, setDue] = useState(5);
  const [trigger, setTrigger] = useState<"always" | "victory" | "passage">(
    "always",
  );
  const [guarantee, setGuarantee] = useState(true);
  const [purpose, setPurpose] = useState<"defense" | "expedition" | "trade">(
    "defense",
  );
  const [stopReports, setStopReports] = useState(true);
  const [focus, setFocus] = useState("");
  const exportRef = useRef(false);
  const previous = useRef(0);
  useEffect(() => {
    worker.onmessage = async ({ data }) => {
      if (data.type === "error") {
        setBusy(false);
        setError(data.error);
        setRunning(false);
      }
      if (data.type === "state") {
        setBusy(false);
        setO(data.observation);
        if (devMode && tab === "開発")
          worker.postMessage({
            type: "debug",
            query: debugQuery,
            personId: debugPerson,
            offset: debugOffset,
          });
        if (data.result && !data.result.ok) setError(data.result.reason);
        else if (data.result)
          setNotice(
            "文書作成キューへ登録しました。命令は伝令到着後に判断されます。",
          );
        if (data.observation.outcome) setRunning(false);
        if (
          data.observation.reports.length > previous.current &&
          data.observation.reports
            .slice(previous.current)
            .some((r: { kind: string }) =>
              [
                "battle_end",
                "treaty",
                "promise_breached",
                "order_response",
              ].includes(r.kind),
            ) &&
          stopReports
        )
          setRunning(false);
        previous.current = data.observation.reports.length;
      }
      if (data.type === "saved") {
        try {
          await persist(data.save);
          setNotice("端末に保存しました。");
          if (exportRef.current) {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(
              new Blob([data.save], { type: "application/json" }),
            );
            a.download = "群雄と約束-save.json";
            a.click();
            URL.revokeObjectURL(a.href);
            exportRef.current = false;
          }
        } catch (e) {
          setError(String(e));
        }
      }
      if (data.type === "debug") setDebug(data.snapshot);
    };
  }, [stopReports, devMode, tab, debugQuery, debugPerson, debugOffset]);
  useEffect(() => {
    if (devMode && tab === "開発")
      worker.postMessage({
        type: "debug",
        query: debugQuery,
        personId: debugPerson,
        offset: debugOffset,
      });
  }, [devMode, tab, debugQuery, debugPerson, debugOffset]);
  useEffect(() => {
    if (!running || busy) return;
    const t = setTimeout(() => {
      setBusy(true);
      worker.postMessage({ type: "advance", minutes: 60 });
    }, 250);
    return () => clearTimeout(t);
  }, [running, busy, o]);
  const cmd = (action: Action) => {
    setError("");
    worker.postMessage({ type: "command", action });
  };
  const step = (minutes: number) => {
    setBusy(true);
    worker.postMessage({ type: "advance", minutes, stopReports });
  };
  const chosen = o?.people.find((p) => p.id === person);
  const ownUnits = o?.units.filter((u) => u.factionId === "a") ?? [];
  const selectedUnit = unit || ownUnits[0]?.id || "";
  if (!started)
    return (
      <div className="landing">
        <div className="seal">約</div>
        <p className="eyebrow">小さな国を、誰と守るか。</p>
        <h1>群雄と約束</h1>
        <h2>峠と収穫</h2>
        <p>
          先代が失った交易路。故郷を離れたがらない隊長。
          <br />
          恩人の願いと、冬を越すための約束。
          <br />
          あなたに残された時間は90日。
        </p>
        <label>
          世界のseed{" "}
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value))}
          />
        </label>
        <button
          className="primary"
          onClick={() => {
            worker.postMessage({ type: "new", seed });
            setStarted(true);
          }}
        >
          統治を始める
        </button>
        <a className="e1-entry" href="/?e1=debug">20人集落の空間デバッグを見る</a> <a className="e1-entry" href="/?e1=v2">物体木版を見る</a> <a className="e1-entry" href="/?a1=debug">自律A1を見る</a> <a className="e1-entry" href="/?e1=a2">自律A2を見る</a> <a className="e1-entry" href="/?e1=a3-income">A3所得試作を見る</a>
        <button
          onClick={async () => {
            const save = await restore();
            if (save) {
              worker.postMessage({ type: "load", save });
              setStarted(true);
            } else setError("保存がありません");
          }}
        >
          保存から再開
        </button>
        <label className="file">
          JSONセーブを読み込む
          <input
            type="file"
            accept=".json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                worker.postMessage({ type: "load", save: await f.text() });
                setStarted(true);
              }
            }}
          />
        </label>
        <small>{error}</small>
        <footer>1,000人の暮らしと、ひとつの峠。外部AI接続なし。</footer>
      </div>
    );
  if (!o) return <p>世界を生成しています…</p>;
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">THE PASS AND THE HARVEST</p>
          <h1>
            群雄と約束 <span>峠と収穫</span>
          </h1>
        </div>
        <div className="clock">
          <strong>{time(o.minute)}</strong>
          <span>
            ／90日 · {o.settlements.find((s) => s.id === o.location)?.name}
          </span>
          <button
            disabled={busy || !!o.outcome}
            onClick={() => setRunning(!running)}
          >
            {running ? "一時停止" : "連続進行"}
          </button>
          <button disabled={busy || !!o.outcome} onClick={() => step(60)}>
            1時間
          </button>
          <button disabled={busy || !!o.outcome} onClick={() => step(1440)}>
            1日
          </button>
        </div>
      </header>
      <div className="resources">
        <span>
          国庫 <b>{o.treasury.money.toLocaleString()}</b>
        </span>
        <span>
          食糧 <b>{o.treasury.food.toLocaleString()}</b>
        </span>
        <span>
          装備 <b>{o.treasury.equipment}</b>
        </span>
        <span>
          商用通行権 <b>{o.passage ? "確保" : "未確保"}</b>
        </span>
        <span>
          伝令 <b>{o.pending.length}</b>
        </span>
        <button onClick={() => worker.postMessage({ type: "save" })}>
          保存
        </button>
        <button
          onClick={() => {
            exportRef.current = true;
            worker.postMessage({ type: "save" });
          }}
        >
          JSON出力
        </button>
        <button onClick={() => setHelp(!help)}>遊び方</button>
      </div>
      <nav>
        {[
          "地図",
          "人物",
          "約束",
          "会戦",
          "振り返り",
          ...(devMode ? ["開発"] : []),
        ].map((t) => (
          <button
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
            key={t}
          >
            {t}
          </button>
        ))}
        <label>
          <input
            type="checkbox"
            checked={stopReports}
            onChange={(e) => setStopReports(e.target.checked)}
          />
          重要報告で停止
        </label>
        <label>
          <input
            type="checkbox"
            checked={devMode}
            onChange={(e) => {
              setDevMode(e.target.checked);
              if (!e.target.checked && tab === "開発") setTab("地図");
            }}
          />
          開発モード
        </label>
      </nav>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice">
          {notice}
          <button onClick={() => setNotice("")}>閉じる</button>
        </div>
      )}
      {help && (
        <section className="tutorial">
          <strong>90日目、君主と首都を守り、峠の商用通行権を持つこと。</strong>
          <p>
            ① 人物でミラとアルノーの願いを聞く。②
            条約を送る、または徴募・補給・進軍を準備。③
            時間を進め、返答を読む。命令は拒否されることもあります。④
            約束を守り、報告の因果を振り返る。
          </p>
          <p>
            外交：3,000通貨＋不可侵を提案。軍事：志願兵を募り、部隊ごとに補給を送って峠へ。民間の徴募は生産を減らします。国庫の食糧は前線に自動では届きません。
          </p>
          <button onClick={() => setHelp(false)}>了解</button>
        </section>
      )}
      {o.outcome && (
        <section className="ending">
          <p className="eyebrow">90日間の記録</p>
          <h2>
            {o.outcome === "victory"
              ? "峠への道は開かれた"
              : "約束の先へ、届かなかった"}
          </h2>
          <p>
            通行権 {o.passage ? "確保" : "未確保"} · 報告された死者{" "}
            {o.summary.dead}人 · 欠食 {o.summary.hungry}人 · 履行{" "}
            {o.summary.fulfilled}件 · 違反 {o.summary.breached}件
          </p>
          <p>
            失った信頼と守れた生活は、ひとつの得点にはできません。人物の報告と約束台帳を振り返ってください。
          </p>
        </section>
      )}
      <main className="layout">
        <aside>
          <h2>家臣と願い</h2>
          {o.people.slice(1, 5).map((p, i) => (
            <button
              className="person-card"
              key={p.id}
              onClick={() => {
                setPerson(p.id);
                setTab("人物");
              }}
            >
              <span className="crest">{["剣", "麦", "帆", "地"][i]}</span>
              <span>
                <b>{p.name}</b>
                <small>
                  {
                    [
                      "先代の恩人。指揮を望む。",
                      "家族を残す村の隊長。",
                      "峠を越える契約を望む。",
                      "収穫の働き手を守りたい。",
                    ][i]
                  }
                </small>
              </span>
            </button>
          ))}
          <h3>未完了の約束</h3>
          {o.promises
            .filter((p) => p.status === "active" || p.status === "proposed")
            .slice(-4)
            .map((p) => (
              <p key={p.id} className="deadline">
                {p.amount}通貨 · {time(p.dueAt)}
                <br />
                {p.trigger === "victory"
                  ? "勝利したら"
                  : p.trigger === "passage"
                    ? "通行権獲得後"
                    : "無条件"}
              </p>
            ))}
          <h3>暮らしの報告</h3>
          <p>
            欠食 {o.summary.hungry}人<br />
            死者の報告 {o.summary.dead}人
          </p>
          <small>遠隔地の状態は届いた報告を表示。</small>
        </aside>
        <section className="center">
          {tab === "地図" && (
            <>
              <div className="panel-title">
                <h2>領邦と交易路</h2>
                <span>
                  選択：{o.settlements.find((s) => s.id === place)?.name}
                </span>
              </div>
              <Map o={o} select={setPlace} />
              <div className="actions">
                <section>
                  <h3>執務：政策と徴募</h3>
                  <label>
                    大義
                    <select
                      value={purpose}
                      onChange={(e) =>
                        setPurpose(e.target.value as typeof purpose)
                      }
                    >
                      <option value="defense">故郷の防衛</option>
                      <option value="expedition">峠への遠征</option>
                      <option value="trade">交易の回復</option>
                    </select>
                  </label>
                  <button
                    onClick={() =>
                      cmd({ kind: "SET_TAX", rate: 0.1, amount: 5, purpose })
                    }
                  >
                    臨時徴税 5通貨／人
                  </button>
                  <button
                    onClick={() =>
                      cmd({
                        kind: "RECRUIT",
                        count: 20,
                        purpose,
                        termDays: 90,
                        reward: 0,
                      })
                    }
                  >
                    20人を募る（定例給与）
                  </button>
                  <p>
                    志願者は目的・生活・信用から判断。実際の加入数は報告で確認。
                  </p>
                </section>
                <section>
                  <h3>ラドとの通行交渉</h3>
                  <label>
                    通行料
                    <input
                      type="number"
                      min="0"
                      value={amount}
                      onChange={(e) => setAmount(Number(e.target.value))}
                    />
                  </label>
                  <button
                    className="primary"
                    onClick={() =>
                      cmd({
                        kind: "NEGOTIATE",
                        amount,
                        nonAggression: true,
                        durationDays: 120,
                      })
                    }
                  >
                    通行料＋不可侵を提案
                  </button>
                  <p>
                    商用のみ・120日。軍用の通行権ではありません。受諾時に国庫から支払います。
                  </p>
                  {o.offers.map((offer) => (
                    <p key={offer.id}>
                      {offer.status} · {offer.amount}通貨
                    </p>
                  ))}
                </section>
              </div>
            </>
          )}
          {tab === "人物" && (
            <>
              <h2>人物を知る</h2>
              <label>
                名前を探す
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <select
                value={person}
                onChange={(e) => setPerson(e.target.value)}
              >
                {o.people
                  .filter((p) => !query || p.name.includes(query))
                  .slice(0, 60)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <article className="character">
                <div className="large-crest">{chosen?.name.slice(-2)}</div>
                <h2>{chosen?.name}</h2>
                <p>
                  世帯 {chosen?.householdId} · 故郷{" "}
                  {o.settlements.find((s) => s.id === chosen?.homeId)?.name}
                </p>
                <p>
                  本心は直接わかりません。届いた返答と、これまでの行動から判断してください。
                </p>
                <label>
                  面談の方法{" "}
                  <select
                    value={audienceMode}
                    onChange={(e) =>
                      setAudienceMode(e.target.value as "summon" | "visit")
                    }
                  >
                    <option value="summon">伝令を出して宮廷に呼ぶ</option>
                    <option value="visit">書記を伴って訪ねる</option>
                  </select>
                </label>
                <button
                  onClick={() =>
                    cmd({
                      kind: "REQUEST_AUDIENCE",
                      personId: person,
                      mode: audienceMode,
                    })
                  }
                >
                  面談を依頼
                </button>
                <p>
                  書記が文書を整えます。呼び出しは伝令が招待状を届け、相手が応じて到着してから成立します。
                </p>
                <button
                  onClick={() =>
                    cmd({
                      kind: "ASSIGN_ROLE",
                      personId: person,
                      role: "general",
                    })
                  }
                >
                  将軍に任命する
                </button>
                <button onClick={() => setTab("約束")}>この人に約束する</button>
                <p>
                  将軍交代は前任者の名誉を傷つけます。部隊の指揮官交代は会戦画面から別に伝達します。
                </p>
              </article>
              <h3>本人から届いた言葉</h3>
              {o.reports
                .filter(
                  (r) =>
                    r.source === person ||
                    r.text.includes(chosen?.name ?? "???"),
                )
                .slice(-10)
                .map((r) => (
                  <p key={r.eventId}>{r.text}</p>
                ))}
            </>
          )}
          {devMode && tab === "開発" && (
            <section className="debug-panel">
              <h2>全員の行動 · 開発用</h2>
              <p><a href="/?e1=debug">E1集落の家・人物・食料を地図で追う</a> · <a href="/?e1=v2">物体木版</a></p>
              <p>
                世界の真実を表示します。通常の君主画面では未確認の情報は表示されません。
              </p>
              <label>
                人物ID・名前・仕事を検索{" "}
                <input
                  value={debugQuery}
                  onChange={(e) => {
                    setDebugQuery(e.target.value);
                    setDebugOffset(0);
                  }}
                />
              </label>
              <p>
                該当 {debug?.total ?? 0} 人 · {debugOffset + 1}〜
                {Math.min(debugOffset + 80, debug?.total ?? 0)}
              </p>
              <div className="debug-layout">
                <div className="debug-list">
                  {debug?.people.map((p) => (
                    <button
                      key={p.id}
                      className={debugPerson === p.id ? "active" : ""}
                      onClick={() => setDebugPerson(p.id)}
                    >
                      {p.id} {p.name} · {p.job} {p.roles.join("/")}{" "}
                      {p.journey ?? ""}
                    </button>
                  ))}
                  <div>
                    <button
                      disabled={debugOffset === 0}
                      onClick={() =>
                        setDebugOffset(Math.max(0, debugOffset - 80))
                      }
                    >
                      前の80人
                    </button>
                    <button
                      disabled={debugOffset + 80 >= (debug?.total ?? 0)}
                      onClick={() => setDebugOffset(debugOffset + 80)}
                    >
                      次の80人
                    </button>
                  </div>
                </div>
                <div className="debug-detail">
                  <h3>
                    {debug?.selected?.name} ({debug?.selected?.id})
                  </h3>
                  <p>
                    現在地 {debug?.selected?.location} ·{" "}
                    {debug?.selected?.alive ? "生存" : "死亡"} ·{" "}
                    {debug?.selected?.job} · {debug?.selected?.roles.join("/")}
                  </p>
                  <h4>個人の行動Event（新しい順）</h4>
                  {debug?.selected?.events.map((e) => (
                    <p key={e.id}>
                      <b>
                        {time(e.worldMinute)} {e.kind}
                      </b>{" "}
                      {e.text}
                      <small>
                        {" "}
                        {e.id} ← {e.causes.join(", ") || "起点"}
                      </small>
                    </p>
                  ))}
                  <h4>毎日の活動（新しい順）</h4>
                  {debug?.selected?.activities.map((a) => (
                    <p key={a.id}>
                      {time(a.worldMinute)} {a.detail}{" "}
                      <small>← {a.sourceEventId}</small>
                    </p>
                  ))}
                  <h4>この人が関わる輸送中の伝令</h4>
                  {debug?.selected?.messages.map((m) => (
                    <p key={m.id}>
                      {m.id} {m.kind}: {m.sender} → {m.recipient} · 伝令{" "}
                      {m.courierId} · 到着予定 {time(m.arriveAt)}
                    </p>
                  ))}
                  <h4>面談</h4>
                  {debug?.selected?.audiences.map((a) => (
                    <p key={a.id}>
                      {a.id} {a.mode} · {a.status} · 書記 {a.staffId} · 伝令{" "}
                      {a.courierId ?? "未配属"}
                    </p>
                  ))}
                </div>
              </div>
              <h3>輸送中の伝令（先頭100件）</h3>
              {debug?.pendingMessages.map((m) => (
                <p key={m.id}>
                  {m.id} {m.kind} · {m.courierId ?? "未配属"} · {m.sender} →{" "}
                  {m.recipient} ({m.destination}) · {time(m.arriveAt)}
                </p>
              ))}
            </section>
          )}
          {tab === "約束" && (
            <>
              <h2>約束は、国庫から支払う。</h2>
              <div className="promise-form">
                <label>
                  受益者
                  <select
                    value={person}
                    onChange={(e) => setPerson(e.target.value)}
                  >
                    {o.people.slice(0, 60).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  総額
                  <input
                    type="number"
                    min="0"
                    value={reward}
                    onChange={(e) => setReward(Number(e.target.value))}
                  />
                </label>
                <label>
                  期限（日）
                  <input
                    type="number"
                    min={o.day + 1}
                    value={due}
                    onChange={(e) => setDue(Number(e.target.value))}
                  />
                </label>
                <label>
                  条件
                  <select
                    value={trigger}
                    onChange={(e) =>
                      setTrigger(e.target.value as typeof trigger)
                    }
                  >
                    <option value="always">無条件の家族扶助</option>
                    <option value="victory">軍事的勝利の後</option>
                    <option value="passage">通行権獲得の後</option>
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={guarantee}
                    onChange={(e) => setGuarantee(e.target.checked)}
                  />
                  保証金を先に確保
                </label>
                <button
                  className="primary"
                  onClick={() =>
                    cmd({
                      kind: "PROPOSE_PROMISE",
                      beneficiaries: [person],
                      amount: reward,
                      dueDay: due,
                      trigger,
                      promiseKind: "family",
                      escrow: guarantee,
                      inherited: true,
                    })
                  }
                >
                  約束を送る
                </button>
              </div>
              <p>
                期限までに支払い、本人に報告が届くと信用が変化します。条件未発動なら違反にはなりません。
              </p>
              {o.promises.map((p) => (
                <article className="promise" key={p.id}>
                  <b>
                    {names[p.status]} · {p.amount}通貨
                  </b>
                  <span>
                    {p.beneficiarySnapshot
                      .map((id) => o.people.find((x) => x.id === id)?.name)
                      .join("、")}
                  </span>
                  <small>
                    {p.id} · 期限 {time(p.dueAt)} · 支払済 {p.fulfilledAmount} ·{" "}
                    {p.escrow ? "保証あり" : "保証なし"}
                  </small>
                </article>
              ))}
            </>
          )}
          {tab === "会戦" && (
            <>
              <h2>準備が、会戦を変える。</h2>
              <Map o={o} select={setPlace} battle />
              <label>
                指揮対象
                <select
                  value={selectedUnit}
                  onChange={(e) => setUnit(e.target.value)}
                >
                  {ownUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.id} · {u.memberIds.length}人 ·{" "}
                      {o.people.find((p) => p.id === u.commanderId)?.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="actions">
                <section>
                  <h3>任務と兵站</h3>
                  <label>
                    目的地
                    <select
                      value={place}
                      onChange={(e) => setPlace(e.target.value)}
                    >
                      {o.settlements.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    onClick={() =>
                      cmd({
                        kind: "DISPATCH_SUPPLY",
                        unitId: selectedUnit,
                        amount: 250,
                      })
                    }
                  >
                    食糧250を送る
                  </button>
                  <button
                    className="primary"
                    onClick={() =>
                      cmd({
                        kind: "ISSUE_ORDER",
                        unitId: selectedUnit,
                        intent: "attack",
                        destination: place,
                        fallback: "capital",
                        retreatFood: 1,
                      })
                    }
                  >
                    進軍・攻撃を命令
                  </button>
                  <button
                    onClick={() =>
                      cmd({
                        kind: "ISSUE_ORDER",
                        unitId: selectedUnit,
                        intent: "retreat",
                        destination: "capital",
                        fallback: "capital",
                        retreatFood: 1,
                      })
                    }
                  >
                    首都へ撤退命令
                  </button>
                  <button
                    onClick={() =>
                      cmd({ kind: "DEMOBILIZE", unitId: selectedUnit })
                    }
                  >
                    首都で復員
                  </button>
                  <p>
                    食糧が1日分を下回れば帰還。伝令・荷車は部隊と別に移動します。
                  </p>
                </section>
                <section>
                  <h3>誰に任せるか</h3>
                  <select
                    value={person}
                    onChange={(e) => setPerson(e.target.value)}
                  >
                    {o.people.slice(1, 5).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() =>
                      cmd({
                        kind: "ASSIGN_COMMANDER",
                        unitId: selectedUnit,
                        personId: person,
                      })
                    }
                  >
                    指揮官の交代を伝える
                  </button>
                  <p>
                    アルノーは先代の恩人。ミラは有能だが、故郷と家族への責任を重んじる。約束の実際の履行が、遠征命令の判断を変えます。
                  </p>
                </section>
              </div>
              <h3>届いた部隊報告</h3>
              {ownUnits.map((u) => (
                <p key={u.id}>
                  {u.id}：
                  {{
                    rest: "休息",
                    attack: "攻撃",
                    defend: "守備",
                    retreat: "撤退",
                    escaped: "離脱",
                    scout: "偵察",
                  }[u.intent] ?? u.intent}{" "}
                  · {o.settlements.find((s) => s.id === u.location)?.name}{" "}
                  {u.destination &&
                    `→ ${o.settlements.find((s) => s.id === u.destination)?.name}`}{" "}
                  · 報告兵数
                  {u.memberIds.length}人 · 食糧 {u.reportedFood ?? "不明"}
                </p>
              ))}
            </>
          )}
          {tab === "振り返り" && (
            <>
              <h2>判断と、その先に起きたこと</h2>
              <p>
                報告を選ぶと、その報告から知られている原因をたどれます。未到着の証言は表示されません。
              </p>
              {o.reports
                .filter((r) => !["unit_report", "economy"].includes(r.kind))
                .slice(-120)
                .reverse()
                .map((r) => (
                  <article
                    id={r.eventId}
                    className={`report ${focus === r.eventId ? "focused" : ""}`}
                    key={r.eventId}
                    onClick={() => setFocus(r.eventId)}
                  >
                    <small>
                      {r.eventId} · 観測 {time(r.observedAt)} → 受領{" "}
                      {time(r.receivedAt)}
                    </small>
                    <p>{r.text}</p>
                    {r.causes
                      ?.map((id) => o.reports.find((x) => x.eventId === id))
                      .filter(Boolean)
                      .map((c) => (
                        <button
                          key={c!.eventId}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFocus(c!.eventId);
                            document
                              .getElementById(c!.eventId)
                              ?.scrollIntoView({ block: "center" });
                          }}
                        >
                          原因：{c!.text}
                        </button>
                      ))}
                    <small>
                      発信 {r.source} · 確度 {Math.round(r.confidence * 100)}%
                    </small>
                  </article>
                ))}
            </>
          )}
        </section>
        <aside className="reports">
          <div className="panel-title">
            <h2>届いた報告</h2>
            <span>最新12件</span>
          </div>
          {o.reports
            .filter((r) => r.kind !== "unit_report")
            .slice(-12)
            .reverse()
            .map((r) => (
              <button
                className="report"
                key={r.eventId}
                onClick={() => {
                  setTab("振り返り");
                  setFocus(r.eventId);
                }}
              >
                <small>
                  {time(r.receivedAt)} · {r.source}
                </small>
                <p>{r.text}</p>
                <small>観測：{time(r.observedAt)}</small>
              </button>
            ))}
          <h3>伝令の到着予定</h3>
          {o.pending.slice(0, 6).map((m) => (
            <p key={m.id}>
              {m.kind} · {time(m.arriveAt)}
            </p>
          ))}
        </aside>
      </main>
      <footer>
        通常AI · seed {seed} · 報告と世界の真実は一致するとは限りません。
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  ["life", "market"].includes(new URLSearchParams(window.location.search).get("individual") ?? "") ?
    <React.Suspense fallback={<p>個人経済を読み込んでいます…</p>}><IndividualDebug initialView={new URLSearchParams(window.location.search).get("individual") as "life" | "market"} /></React.Suspense> :
  new URLSearchParams(window.location.search).get("a1") === "debug" ?
    <React.Suspense fallback={<p>A1を読み込んでいます…</p>}><A1Debug /></React.Suspense> :
  new URLSearchParams(window.location.search).get("e1") === "debug" ?
    <React.Suspense fallback={<p>集落を読み込んでいます…</p>}><E1Debug /></React.Suspense> :
  ["v2", "a2", "a3-income"].includes(new URLSearchParams(window.location.search).get("e1") ?? "") ?
    <React.Suspense fallback={<p>物体木を読み込んでいます…</p>}><E1V2Debug autonomousBuyers={new URLSearchParams(window.location.search).get("e1") === "a2"} incomeExperiment={new URLSearchParams(window.location.search).get("e1") === "a3-income"} /></React.Suspense> : <App />,
);

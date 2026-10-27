// 骨格の記録の画面の計算係。設定から走らせて記録を作り、記録から再生し直して一定の時刻ごとの写しを取り、最後の状態が記録と同じかを確かめる。
// 画面はこの写しから少しだけ再生して、任意の時刻を表示する。
import { finalOf, registryMismatch, replayRecording, runConfig } from "../../packages/skeleton/index";
import type { Recording, ScenarioConfig, WorldState } from "../../packages/skeleton/index";

export type SkeletonWorkerRequest =
  | { type: "run"; config: ScenarioConfig; days: number; every: number }
  | { type: "open"; recording: Recording; every: number };

export type SkeletonWorkerResponse =
  | { type: "progress"; phase: "run" | "replay"; done: number; total: number }
  | { type: "ready"; recording: Recording; checkpoints: { t: number; state: WorldState }[]; verified: { replay: boolean; registry: string[] }; elapsed: { run: number; replay: number } }
  | { type: "error"; message: string };

const post = (m: SkeletonWorkerResponse) => (self as unknown as Worker).postMessage(m);

/** 記録を初めから再生し、every 分ごとに写しを取る。最後に、記録の最後の状態の要約と同じかを確かめる。 */
function checkpoints(rec: Recording, every: number) {
  const started = performance.now();
  const out: { t: number; state: WorldState }[] = [{ t: rec.initial.now, state: rec.initial }];
  let w = replayRecording(rec, rec.initial.now);
  for (let t = rec.initial.now + every; ; t += every) {
    const until = Math.min(t, rec.until);
    w = replayRecording(rec, until, w.save());
    out.push({ t: until, state: w.save() });
    post({ type: "progress", phase: "replay", done: until, total: rec.until });
    if (until >= rec.until) break;
  }
  const end = finalOf(w);
  // 途中の写しから続けた再生でも、記録の世界と事物の値は同じになる（記録の要約は、続けた分の記録しか持たないので事物で比べる）。
  return { out, replay: end.thingsHash === rec.final.thingsHash && end.now === rec.final.now, elapsed: performance.now() - started };
}

self.onmessage = ({ data }: MessageEvent<SkeletonWorkerRequest>) => {
  try {
    let rec: Recording;
    let run = 0;
    if (data.type === "run") {
      const started = performance.now();
      post({ type: "progress", phase: "run", done: 0, total: data.days * 1440 });
      rec = runConfig(data.config, data.days, (now, until) => post({ type: "progress", phase: "run", done: now, total: until })).recording;
      run = performance.now() - started;
    } else rec = data.recording;
    const cp = checkpoints(rec, data.every);
    post({ type: "ready", recording: rec, checkpoints: cp.out, verified: { replay: cp.replay, registry: registryMismatch(rec) }, elapsed: { run, replay: cp.elapsed } });
  } catch (cause) {
    post({ type: "error", message: cause instanceof Error ? `${cause.message}\n${cause.stack ?? ""}` : String(cause) });
  }
};

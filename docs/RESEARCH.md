# 設計思想の背景調査――資源・主体・法則・作用過程

更新: 2026-10-24。設計の根拠を扱う正本。[設計原則](DESIGN.md)と対になる。実装手順や日々の経過はここへ蓄積しない。

## 調査の問いと結論

問いは、世界と人物を単なる処理の入口にせず、**何が実在し、誰が何を管理し、どの条件で何が変化するか**を、実装に先立って定められるか、である。仕組みの抽象化だけでは、食べ物の実在、保管、競合、身体への作用を説明できない。

出発点として、**資源を管理する世界と人物、両者を拘束する法則、具体的な資源へ作用する過程**を核にするのが妥当である。ただし、これは下記の理論から得た区別を組み合わせた、このプロジェクトの設計判断である。一つの既成理論がこの世界全体を証明・規定しているわけではない。

根拠には役割の違いがある。REAは資源・出来事・主体の関係、Valueflowsは具体的な資源と過程の入出力、DDDは整合性と責任の境界、存在論は実在物・性質・過程の区別を助ける。経済理論は、その上で情報差・権利・約束・利害を持つ人物間の営みを説明する。記録方式やクラス配置は、この構造を実現する段階で選ぶ。

<a id="why-stalled"></a>
### 前回の設計が止まった理由

この調査の出発点は、前回の設計が大枠の構造で失敗して止まったことである。記録は次のとおり。2026-09-25の[適合調査](archive/ARCHITECTURE_FIT_AUDIT.md)は、刺激の受信・解釈・動機・判断がsim内で混ざり、日次処理が仕事・給与・消費を直接更新していると判定した。世界側は資源と過程ではなく、処理の入口で組まれていた。その後の設計は人物内部の判断方式へ集中し、[運用契約](foundations/HMOSAIC_RUNTIME_CONTRACT.md)・[形式仕様](foundations/HMOSAIC_FORMAL_SPEC.md)など5本約1,800行と、[実装前レビュー](foundations/HMOSAIC_IMPLEMENTATION_READINESS_REVIEW.md)の未決12項目を生んだ。接続試作の[v25](baseline/HMOSAIC_RECOVERY_V25_RESULT.md)では、回復の候補に休息がなく初日に疲労死し、修正後も食品取得・食事が接続されず全員が栄養死した。再編直前の[引き継ぎ](archive/NEXT_SESSION_HISTORY_2026-10-24.md)の「次の作業」は遠隔在庫の表示項目の分離であり、90日生存は未達のままだった。

反省は二つある。第一に、変化を起こす仕組みが「過程」として一種類に揃っておらず、食事のような基本の作用が人物内部への特別な配線作業になり、着手されなかった。第二に、動く骨格がないまま判断方式の細部と契約を増やし、要件を実行から抽出できなかった。資源・法則・過程を核にするという本調査の結論は、この二点への答えである。ある程度自律的に動く骨格を先に作り、細かな要件は動かしながら抽出して直す。

## 根拠の読み方

- **一次資料で確認した事実**: 著者・標準化団体・実装元の説明と、対象箇所のソースコード。資料ごとに確認範囲を示す。
- **構造上の類似からの推論**: 理論の採用を著者が明言していない実装にも、比較に使える分離がある。類似だけでREA・DDD実装とは呼ばない。
- **本プロジェクトで採用する制約**: 根拠を参照して[DESIGN](DESIGN.md)に定める。外部理論の権威と、こちらの採用判断を混同しない。

調査は2026-10-24までの公開資料の対象箇所に限る。リンク先全体の通読、標準全文の購入・照合、外部実装のビルド・実行はしていない。「確認範囲に完全な適用例がなかった」は、世界中に存在しないという意味ではない。

<a id="rea"></a>
## 1. REA――何が変わり、誰が関わったか

McCarthyのREAは、経済資源、資源を変化させる経済イベント、関与するエージェントとその関係を中心に置く。会計上の集計値だけでなく、資源の増減や交換の実態を追う出発点になる。[McCarthy, 1982（出版社）](https://doi.org/10.2308/TAR-4487748)

このプロジェクトでは、パンを買ったつもり、代金を払う約束、実際に引き渡されたパンを分ける根拠になる。人物の判断だけから所持量や栄養を増やす構造を避けられる。一方、経済資源という範囲を、そのまま自然界の全存在や身体生理へ拡張することはできない。

### REAを用いたシミュレーション

Laurier・Poelsの *Invariant Conditions in Value System Simulation Models*（2013）は、REAの三公理を供給連鎖・価値連鎖・業務過程の三層に言い換え、ExSpecTの色付き時間付き階層Petri netでBeer Gameの価値系を離散事象シミュレーションとして動かした。資源・出来事・主体の関連を、動作するモデルの整合条件へ進めた直接的な先例である。2026-10-24に公開著者稿の全文（本文30ページ）を読んだ。[大学掲載の論文と公開稿](https://biblio.ugent.be/publication/4087707)

論文の表1が言い換えた不変条件は次のとおり。第一公理: 各経済資源には少なくとも一つの流入事象と流出事象があり、事象は識別できる資源に作用する（供給連鎖では「資源は組織から組織へ流れる」）。第二公理: 資源を消費する事象は、いずれ資源を生産する事象と対になる。著者はこれを業務過程の段階では「物質保存則」と呼ぶ（価値連鎖では「交換に関わる各組織は資源を手放して別の資源を得る」）。第三公理: 各経済事象には組織内の責任者が少なくとも一人いる（供給連鎖では「交換には二つ以上の組織が要る」）。さらに、公理の違反はモデルの境界を示す印として使える。工場モデルで水・麦芽に流入が無く、廃棄物に流出が無いことを、著者は「モデルの境界にいる合図」と読み、拡張の指針にしている。

モデルの構造も参考になる。経済事象はトークン（資源）を消費・生産する遷移、在庫は単一トークンを持つ店（store）、未履行の注文・受注残は約束を表す店、情報の流れは資源の流れを調整する別のトークンである。資源を変えない事象は「業務事象」として経済事象から区別される。モデルファイルは公開されておらず、ExSpecTは入手できない（Bakkenist社の製品で、後にProtosへ統合されたと2005年の文献にある）。

ただし、この論文の公理は「健全な代謝」を前提に置く。資源は永久に貯蔵されず、企業は努力に報われる。こちらでは、支払い不履行、浪費、資源の滅失、飢餓死も成立する必要がある。将来の対価への期待と、実際に得た対価を分け、取引の成功や資源の有効利用を世界の必然にしない。身体・自然過程・変換の速度は扱っておらず、時間は遷移の遅延だけである。

<a id="rea-figure"></a>
### REAの図そのものと、単位・協調空間

2026-10-24、ユーザーの「新しい概念を作らず、調査の中にある適切なものを使え」という指摘を受けて、REAの図そのものを一次資料で確認した。結論は、**大構造の図はREAの基本図と、REAU／ISO 15944-4 の経済単位・協調空間でそのまま表せる**。こちらが言い換えた「資源・行為者・境界」は不要で、REAの語を使う。

**基本REA。** 経済資源、経済事象、経済主体の三つと、四つの関係からなる。stock-flow は資源と事象の関係で、事象が資源の流入か流出かを表す。duality は事象と事象の関係で、資源を得るには別の資源を手放すという対を表す。participation は事象と主体の関係で、from と to の二役を持つ。custody は主体と資源の関係で、保管を表す。定義は、経済資源が「主体の制御下にあり、主体から主体へ移転できる価値あるもの」、経済事象が「資源の制御の主体間の移転」、経済主体が「事象に参加できる者」。知識レベルには経済資源タイプ（資源の型）、経済コミットメント（将来の事象を行う義務。資源タイプを reserves し、事象に fulfils される）、経済契約（コミットメントの入れ物）、業務過程がある。出典は INTEROP プロジェクトの講義資料（[Johannesson 2006](https://people.dsv.su.se/~distans/INTEROP/INTEROPWP10/BMREAIntro.pdf)、教育目的の利用が許可されている。スライド6〜8、12、17、20）。

![図A　REA の基本図](figures/research-figA-rea.svg)
<!-- 図の正本は figures/src/research-figA-rea.mmd。scripts/docs/render-figures.cjs で SVG を再生成する -->

**単位と協調空間。** McCarthy 1982 の control participation は、事象・内部主体・外部主体の三項関係である。Hruby 2006 以降の多くの実装は二項の participation に置き換えた。[Laurier・Kiehn・Polovina 2011](https://research.dial.uclouvain.be/bitstreams/be52fc37-08b2-4c22-a563-9e12650d5679/download) の REAU は、これを**経済単位（unit）**として明示する。経済単位は「経済事象の効果を受ける（一群の）自然人・法人」で、同じ人物が主体と単位の両方を演じられる。stock-flow は「どの単位にとっての流入か流出か」、duality は「どの単位にとって流入事象と流出事象が対になるか」、participation は「どの単位のために参加するか」として、すべて単位に相対的な三項関係になる。企業中心の依存ビューでは単位が暗黙で一つだが、供給連鎖中心の独立ビュー（ISO/IEC 15944-4 の OeBTO）では、単位どうしの**協調空間**で流入・流出を扱い、内部主体は協調空間に現れず、双対性は協調空間に一つだけ存在して全当事者がその存在に合意する。ISO 15944-4 の要旨は、業務取引を「当事者ごとに一つ、二つのREA構成を接合したもの」と述べる（[FDIS 要旨](https://www.jtc1sc32.org/doc/N1501-1550/32N1511A-ABSTRACT_FDIS_15944-4_doc)。本文は委員会草案PDFが破損しており未入手）。

![図B　経済単位と協調空間](figures/research-figB-units.svg)
<!-- 図の正本は figures/src/research-figB-units.mmd。scripts/docs/render-figures.cjs で SVG を再生成する -->

**Valueflows の核。** 公式序文は、主体（Agent）が経済事象（Economic Event）を行って経済資源（Economic Resource）に作用し、事象は資源を produce・modify・consume・use するか、主体間で transfer するか、場所間で transport すると述べる。過程（Process）は流れをつなぎ、交換（Exchange）は合意に基づく二つの相互の流れである。[序文](https://www.valueflo.ws/introduction/core/)

**こちらの言い換えとの対応。** 行為者は経済主体（自然は Valueflows の EcologicalAgent）。境界は経済単位とその custody。所属はどの単位の保管下にあるか。行為は経済事象。境界内の変換は、同じ単位の中で consume・use（減分）と produce（増分）が双対になる変換過程。境界を越える移動は、単位間の交換・移転で、give と take が双対になり、協調空間で両単位が合意する。影響範囲は、事象の stock-flow と from／to を単位ごとに読んだものに他ならない。したがって新しい概念は要らない。残るこちらの追加は、自然を主体に置くこと、身体を資源に置くこと、法則に速度と時間を持たせることの三つで、これはREAもValueflowsも扱わない。

<a id="event-as-action"></a>
### 作用としての出来事：資料に共通するもの

同日、ユーザーは「境界とは、存在単位どうしの資源の取引、さらに言えば相互作用であり、物理現象もその一種で、要するに事物に何らかの作用があるということではないか。資料はどれも同じことを扱っているはずだ」と指摘した。資料と実装を読み直すと、そのとおりである。どの資料も、**事物（作用を受け、状態を持つもの）**と、**事物への作用（参加者を持ち、事物の流入と流出が釣り合う出来事）**の組を原始概念にしている。境界・取引・相互作用・物理現象は、作用の種類か見方であって、別の部品ではない。

| 資料 | 事物 | 作用 | 参加者 | 釣り合い | 境界はどこに現れるか |
|---|---|---|---|---|---|
| REA（McCarthy 1982、Geerts・McCarthy） | 経済資源 | 経済事象。「資源の制御の主体間の移転」 | 経済主体。from と to | duality。資源を得るには別の資源を手放す | 事象そのもの。二主体の間で制御が移る点 |
| Hruby 2006 の整理 | 同上 | 交換過程（give・take）と変換過程（use・consume・produce）の二種。五つの stock-flow | 交換は二主体、変換は一主体 | 交換の双対と変換の双対 | 交換は主体間、変換は主体内。[Laurier・Bernaert・Poels 2010 の統合モデル](https://www.scitepress.org/Papers/2010/28717/28717.pdf) は両者を一つにする |
| REAU、ISO/IEC 15944-4 | 同上 | 同上。単位にとっての流入か流出か | 経済単位 | 協調空間に一つだけ存在する双対性に全当事者が合意 | 協調空間。二つのREA構成の接合面 |
| Laurier・Poels 2013（Petri net） | トークン（店に置かれた資源） | 遷移（processor）。入力トークンを消費し出力トークンを生成 | 遷移を担う系（組織） | 第二公理を「物質保存則」と呼ぶ | 系と系をつなぐ pin。組織間の資源の流れはそこを通る |
| Valueflows、hREA | EconomicResource | EconomicEvent（produce・consume・use・transfer・move）と Process | Agent（Person・Organization・EcologicalAgent）。provider と receiver | action 効果表の増減、Exchange は合意に基づく二つの相互の流れ | transfer 系の action。provider と receiver が異なる事象 |
| BFO | 継続体（物、性質、傾向性） | 過程（occurrent）。時間に展開する変化 | 過程への参加（participation） | 定めない | 定めない。参加者が複数の過程がそれにあたる |
| 経済理論（Williamson 1981） | 財・サービス | 取引。「財やサービスが技術的に分離可能な接面を越えて移転するときに生じる」 | 取引の両当事者 | 契約で定める | 接面（interface）が取引を定義する。[要旨](https://acawiki.org/The_economics_of_organization:_The_transaction_cost_approach) |
| Coad のカラーモデリング | 緑（Party・Place・Thing） | 桃（Moment-Interval。追跡すべき時点・期間の出来事） | 黄（Role を担う Party） | 青（Description）が型を与える | Moment-Interval が複数の Party を結ぶ |
| DDD（Evans、[Fowler の要約](https://martinfowler.com/bliki/DDD_Aggregate.html)） | 集約（単位として扱う対象の塊） | トランザクション。「集約の境界を越えてはならない」 | 外からは集約ルートだけを参照 | 集約内で不変条件を保つ | 集約の境界。集約間の変化は別のトランザクション |
| abcEconomics（確認版） | 主体の在庫（haves）と予約量 | sell・buy の申し出、accept、give | 送り手と受け手 | 申し出で予約し、受諾で両側を更新 | 受け手側は accept で即時更新、送り手側はメッセージ到着時に commit。両側は別の時点で更新される |
| Mars Sim（確認版） | ResourceHolder の在庫（Settlement・Vehicle・Person・Equipment） | retrieve と store の二段。Trade ミッションは交渉、売り荷の降ろし、買い荷の積み込みを別の局面で行う | 移転元と移転先の保持者 | 容量を超えた分は返す | 保持者の切り替わり。両側の確定は同時ではない |

この表から三つが言える。第一に、原始概念は「事物」と「事物への作用」で足りる。参加者（主体）は作用の属性であり、境界は作用の両側に別の保管者がいることの別名である。第二に、作用には釣り合いの規則がある。REAの双対性、Petri netのトークン保存、Laurier・Poelsの「物質保存則」、物理の保存則は、同じ要請を別の語で言っている。こちらが「法則」と呼んだものは、作用の型が持つ釣り合いと速度の規則である。第三に、実装上の分かれ目は「両側を一つの作用として確定するか、二段に分けるか」にある。REA、ISO 15944-4、Valueflows の Exchange は一つの双対性として扱い、abcEconomics と Mars Sim は予約を挟んだ二段で扱う。DDD の「トランザクションは集約の境界を越えない」は、作用そのものを一つの単位にすれば両立する。

したがって大構造の原始概念は、REA/BFO の語で、資源（事物。身体を含む）、出来事（事物への作用。参加者、流入と流出、釣り合い、速度と期間）、主体（参加者。人物と自然）、型（知識レベル。資源タイプ、過程仕様、効果表）の四つに収まる。取引は二主体の交換の双対、物理現象は自然を参加者とする作用、知覚と伝達は複写しても元が減らない情報という事物への作用である。「境界」「行為者」「影響範囲」という言い換えはこの四つから導けるので、本文の語としては使わない。

**ユーザーの定式化（2026-10-24、合意）。** 「事物の属性ごとに、決まる作用が双方向で起こる」と考えると、さらに簡単になる。作用の型は事物の属性（量、鮮度、所在、保管者、栄養、温度、知識）ごとに定まり、作用は関わる二つの事物の双方の属性を同時に変える。資料の対応は次のとおり。REA の stock-flow は資源の量という属性への作用で、duality がその双方向性である。hREA の action 効果表で transfer・move が `DecrementIncrement`（片方を減らし片方を増やす一つの効果）として定義されているのは、この双方向の作用を一語で表したものにあたる。Petri net の遷移は入力の店と出力の店のトークンを同時に変える。物理の相互作用は、関わる属性（質量、電荷、温度）ごとに法則が決まり、作用と反作用が対で起こり、保存則が釣り合いを与える。BFO では、性質と傾向性を持つ継続体が過程に参加する。知覚は、観測対象の可視属性と観測者の知識属性の間の作用で、対象側の変化がゼロに近い双方向の特殊例である。この定式化では、主体・単位・境界は、作用に参加する事物と、その保管者という属性から導かれる派生概念になる。

**ゲームエンジンとの対応と相違（ユーザーの指摘）。** Unity の GameObject・Component・毎フレームの Update と物理ステップは、事物・属性・作用に対応する。公式マニュアルでは、物理ステップ（衝突検出、剛体の積分、OnCollisionEnter 等の呼出し）が FixedUpdate または Update の直後に走る（[実行順](https://docs.unity3d.com/Manual/execution-order.html)）。Unity の ECS では、Entity は識別子、Component はデータ、System がそれを処理する論理で、データと論理を分ける（[Entities の概念](https://docs.unity3d.com/Packages/com.unity.entities@1.0/manual/concepts-intro.html)）。これは「属性ごとに決まる作用」を System として書く形にあたる。際立った相違は、こちらでは資源のやりとりが厳格なことである。ゲームエンジンは Update の中で任意の対象を任意に書き換えられ、何かを無から生成しても止めないが、こちらでは作用だけが属性を変え、作用は双方向で釣り合い、Laurier・Poels の不変条件（流入と流出、消費と生産の対、責任者）を検査に通す。前回の失敗は、この「Update で何でもできる」形に近づいたことでもある。

<a id="attribute-driven-impl"></a>
### 属性が作用を決める実装は、調査の中にあるか

ユーザーの「事物・属性・作用の三つが重要で、属性は事物に属し作用の性質を決める。調査にそういう実装はないか」という問いで、資料と実装を「属性が作用を決めるか」「両側を一度に変えるか」「釣り合うか」「時間を持つか」の四点で見直した（2026-10-24）。Mountaincore のリンクは `rossturner/mountaincore` が正しく、本節で修正した。

| 実装・形式 | 事物と属性 | 属性が作用を決めるか | 両側を一度に変えるか | 釣り合うか | 時間を持つか |
|---|---|---|---|---|---|
| 色付き Petri net（Laurier・Poels の ExSpecT、[CPN の定義](https://en.wikipedia.org/wiki/Coloured_Petri_net)） | トークンが色（データ値）を持ち、店は色集合を持つ | 決める。遷移のガードは色の式で、偽なら発火しない。弧の式がどの色のトークンを消費・生成するか定める | 発火で入力の店と出力の店を同時に変える | 弧の式で消費と生成を対応づければ釣り合う | 時間付き CPN が時刻と遅延を持つ。[CPN Tools](https://cpntools.org/) は無償だが 2015 年の 4.0.1 で開発停止、CPN IDE に置き換え |
| [Mountaincore](https://github.com/rossturner/mountaincore/blob/08afcf6d276f0d4a75c14bf34e02d169a4322ea8/core/src/main/java/technology/rocketjump/mountaincore/entities/model/Entity.java)（Java、MIT） | `Entity` が物理・位置・行動の部品と、クラスをキーにした `EntityComponentMap` を持つ。`update` は行動部品にだけ委譲 | [ConsumeFoodAction](https://github.com/rossturner/mountaincore/blob/08afcf6d276f0d4a75c14bf34e02d169a4322ea8/core/src/main/java/technology/rocketjump/mountaincore/entities/ai/goap/actions/nourishment/ConsumeFoodAction.java) は食品割当て（属性）の有無と経過時間（6秒）で決まる | 食品数量 −1 と需要 +50 を同じ `update` で行う | 釣り合わない。両方とも固定値で、数量と需要の対応は無い。割当ての解放は別の場所 | 経過時間で完了する |
| Rust 版 COLONY（[components.rs](https://github.com/ryankopf/colony/blob/e9a8f2bf621cb745d61a940fa69f9c8ac57a65ba/src/components.rs)、[eat.rs](https://github.com/ryankopf/colony/blob/e9a8f2bf621cb745d61a940fa69f9c8ac57a65ba/src/task_system/eat.rs)、Bevy ECS） | `PhysicalBody`（needs）、`Food`（nutrition・spoilage）などの部品 | System が部品の組（Query）で対象を選ぶ | 需要を上限に設定し食品を despawn する。同じ実行内 | 釣り合わない。`Food` の nutrition は読まれず、フィルタにしか使われていない | 無い |
| Unity ECS（[概念](https://docs.unity3d.com/Packages/com.unity.entities@1.0/manual/concepts-intro.html)、[System](https://docs.unity3d.com/Packages/com.unity.entities@1.0/manual/concepts-systems.html)） | Entity は識別子、Component はデータ | System が部品データを次の状態へ変える論理 | System の書き方次第 | 強制しない | 毎フレーム |
| Unreal Gameplay Ability System（[Attribute](https://dev.epicgames.com/documentation/en-us/unreal-engine/gameplay-attributes-and-attribute-sets-for-the-gameplay-ability-system-in-unreal-engine)、[Gameplay Effect](https://dev.epicgames.com/documentation/en-us/unreal-engine/gameplay-effects-for-the-gameplay-ability-system-in-unreal-engine)） | Actor が AttributeSet（Health 等の浮動小数の属性。基本値と現在値）を Ability System Component に持つ | Gameplay Effect は属性を変える方法だけを記したデータ資産で、修飾子（どの属性をどう変えるか）とタグ要件を持つ | 対象 Actor 一体に適用する。双方向ではない | 強制しない | Instant・Has Duration・Infinite の持続方針、周期、重ね掛け。実行時は Effect Spec という実例 |
| hREA の action 効果表 | EconomicResource の accountingQuantity と onhandQuantity | action ごとに増減が決まる | transfer・move は `DecrementIncrement` で二資源を一度に変える | 増減が対になる | 無い（時刻は事象の属性） |

結論は三つ。第一に、「属性が作用を決める」実装は調査の中に複数ある。形式としては色付き Petri net のガードと弧の式、エンジンとしては ECS の System と Unreal の Gameplay Effect、記録としては hREA の効果表である。第二に、「両側を一度に、釣り合いをもって変える」のは REA/hREA と Petri net だけで、ゲームとエンジンは両側を同じ更新で変えても釣り合いを強制しない。Mountaincore と COLONY の食事は、数量と需要が独立の固定値である。第三に、「属性ごとの作用の型」と「時間を持つ実例」を分けて持つ実装は Unreal の Gameplay Effect（資産）と Effect Spec（実例）、CPN の遷移と発火である。この三点を一つに持つ既存実装は確認できなかったので、基本のオブジェクトは、事物（Entity／Actor）、属性（Component／AttributeSet。保管者を含む）、作用の型（Gameplay Effect の資産に CPN のガードと REA の釣り合いを加えたもの）、作用の実例（Effect Spec と遷移の発火に時刻・期間・再評価を加えたもの）として、既存の語で組み立てる。TypeScript の ECS 基盤として [bitECS](https://github.com/NateTheGreatt/bitECS)（MPL-2.0、型定義あり）と [miniplex](https://github.com/hmans/miniplex)（MIT、型定義あり）があるが、採否は骨格の後に決める。

MAREAは名前と公開要旨でREAの利用を明示する多主体ビジネスシミュレータである。2018年の論文は、商社モデルの実行からイベントログを抽出し、プロセスマイニングへつなぐ実装を報告する。確認できたのは出版社の公開要旨などで、本文全体と対応ソースコードは未確認。2026-10-24に二度検索したが、原著（Vymětal・Schoeller 2012、Silesian University in Opava）を含めソースコードや配布物は見つからなかった。身体を持つ人物の生活世界全体の実装とは確認していない。[Itoほか, 2018](https://link.springer.com/article/10.1007/s10588-018-9268-6)

<a id="value-kinds"></a>
### 事物が持つ値の四区分：属性・状態・関係・資源

2026-10-25、ユーザーの問い「属性と状態（ステータス）は違うのではないか。友人の相性のように、相手との組や向きで変わるものは属性か状態か」から、資料を「値がどこに属し、何がそれを変えるか」で読み直した。結論は、値は四つに分かれ、基準は固定か可変かではなく**更新がそれを書くかどうか**である。「可変属性」という区分は置かない。更新が書くなら状態である。

| 区分 | 定義 | 例 | 資料の対応 |
|---|---|---|---|
| 属性 | 仕様の側の値。どの法則が当たり得るか、どの速さかを決める。更新は書かない。変えるには別の事物に置き換えるか、明示の出来事が要る | 男女、草食・肉食、見える範囲、採る速さ | REA・Valueflows の知識レベル（ResourceSpecification）、CPN の色集合とガード、Unreal GAS のタグ要件、Coad の青（Description）、BFO の傾向性 |
| 状態 | 運用の側の値。更新が書くものはすべて状態。種類のようでも変わる値（子供→大人、新鮮→腐敗、生→死）はここ | 位置、空腹、意図、生死 | Valueflows の EconomicResource の `stage`・`state`（仕様ではなく実物側）、BFO の性質（quality） |
| 関係 | 相手ごとに持つ状態。向きは両側が別に持つ | 友人の相性、好意、親子、所有、雇用。心象もこの形 | BFO 2020 の関係的性質、Valueflows の AgentRelationship と AgentRelationshipRole、Coad の黄（Role）、経済理論の特定相手への依存（ホールドアップ）と委任（プリンシパル＝エージェント） |
| 資源 | 量として保存される状態。釣り合いはここだけに掛かる | 栄養、鮮度、蓄え、廃棄 | REA の stock-flow と duality、hREA の DecrementIncrement、Petri net のトークン保存 |

法則のガードは四つとも読む。空腹（状態）なら食べられる物（属性）に、親（関係）なら自分の子に注意が向く、という規則は三つを一緒に読む。区別は読む側ではなく書く側にある。

確認した一次資料（2026-10-25）。BFO 2020 の公開コア定義（[公式案内](https://bfo-ontology.github.io/bfo-2020.html)、[定義ファイル bfo-core.ofn](https://github.com/BFO-ontology/BFO-2020/blob/master/21838-2/owl/bfo-core.ofn)）は BFO_0000145「relational quality」を「b は性質であり、互いに異なる c と d が存在して、b が c にも d にも特異的に依存する」と定義する。Valueflows の型定義 [`@valueflows/vf-graphql`](https://www.npmjs.com/package/@valueflows/vf-graphql) 0.9.1-alpha.4（`schemas/agent.gql`、`index.d.ts`）には `AgentRelationship`（二主体と `relationship: AgentRelationshipRole`）と `AgentRelationshipRole`（「二つの主体の間に存在する経済的な関係の役割。member、trading partner など」）がある。[流用範囲の表](#rea-reuse)に挙げた EconomicResource の `stage`・`state` は実物側の項目である。Coad の役割と経済理論は[第4節](#other-modeling)・[第6節](#economics)の記録のとおり。

資料に無いもの。相手の属性と自分の状態（空腹、関心、注意）から何に注意を向けるかを選ぶ規則（関心の段）は、どの資料にも無い。候補として Unreal の AI Perception の所属フィルタ、Mountaincore の派閥があるが未確認。対に付く状態を一級の部品として持つ ECS として Flecs の relationship があるが未確認。四区分を一般の法則に落とすには、男女・捕食・親子・友人・所有・雇用を要件として集め、定義が全部に当てはまるかを見る。

<a id="conventions"></a>
### 種類が増えても壊れない書き方の定石

2026-10-25、ユーザーの問い「派生（継承）を使わないと、事物の種類が増えたときフラグと if のお化けにならないか。オブジェクト指向とその後の研究に定石があるのではないか」に答えて、関連する定石を一次資料で確かめた。結論は、分野を越えて同じ形に収束している。**種類は型やクラスではなくデータであり、振る舞いは組に対する規則で、規則は札の組で選ぶ。** 事物の派生クラスにメソッドを持たせる形は、相互作用が二つの事物の間で起こるため片側しか選べず、相手側の分岐（種類 × 種類）が残る。

| 定石 | 内容 | 確認した一次資料 | ここでの対応 |
|---|---|---|---|
| 継承より合成 | 振る舞いは部品の組合せで作り、クラス階層で作らない。Gamma ほか『デザインパターン』（1994）の原則 | [Wikipedia の項](https://en.wikipedia.org/wiki/Composition_over_inheritance)（原典の引用を含む。原典本文は未照合） | 札の重ね合わせ |
| 式の問題 | 新しい型の追加と新しい操作の追加を、既存コードを変えずに両立させる難しさ。OOP は型の追加が易しく操作が難しく、関数型は逆 | [Wadler 1998 の原文](https://homepages.inf.ed.ac.uk/wadler/papers/expression/expression.txt) | 種類はデータなので追加はただ、操作は法則を一つ足す。両方が易しい |
| 多重ディスパッチ | 引数の型の組で処理を選ぶ。単一ディスパッチの相手側分岐を解消する | [Julia のマニュアル](https://docs.julialang.org/en/v1/manual/methods/)（「multiple dispatch … a powerful and convenient paradigm for structuring and organizing programs」） | 法則のガードが (a の札, b の札) で選ぶ |
| ECS とデータ指向 | Entity はデータ、System は「部品 X と Y を持つもの」を問い合わせて処理する | [Unity Entities](https://docs.unity3d.com/Packages/com.unity.entities@1.0/manual/concepts-intro.html)、[Bevy の ECS 入門](https://bevyengine.org/learn/quick-start/getting-started/ecs/)（Query）、[Flecs の Relationships](https://github.com/SanderMertens/flecs/blob/master/docs/Relationships.md)（(Likes, Bob) のような組を一級の部品に持つ） | 法則が札の組で相手を選ぶ。関係（相手ごとの状態）は Flecs の組にあたる |
| データ駆動の種類の定義 | 生物や物の種類を定義ファイルの札で書き、種類を何百足してもコードを変えない。親の定義から既定値を継ぐ | [Dwarf Fortress の生物トークン](https://dwarffortresswiki.org/index.php/Creature_token)（CARNIVORE、GRAZER など）、[RimWorld の Def と ParentName 継承](https://rimworldwiki.com/wiki/Modding_Tutorials/Def_classes)、[Unreal の GameplayTag](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-gameplay-tags-in-unreal-engine)（階層つきの札） | 種類の定義 `ThingDef`（parent で既定値を継ぐ）、札の値の階層 |

The Sims の smart object（物が「自分に何ができるか」を広告し、人物は汎用）も同じ系列の定石として知られるが、一次資料（Wright・Forbus の講義資料や GDC 講演）は今回取得できず未確認。

**お化けになる条件と規律。** どちらの書き方でも、札を旗のように読んで一つの法則の中で `if 植物 … else if 肉 …` と分岐し始めればお化けになる。規律は「一法則は一つの相互作用、ガードは札の組の判定だけ。分岐が増えたら法則を割る。法則は種類名（kind）を読まない」。種類の違いは札の値（`eats: plant` と `edible: plant` の一致）で吸収し、歩留まりのような差は札の値で持つ。法則の数は相互作用の種類の数に比例し、事物の種類の数には比例しない。

**派生（継承）が向く場所。** 判断の仕組みだけが違う心（rule・NN・LLM・人間）の実装クラス、法則どうしの共通処理、種類の定義の既定値の継承（RimWorld の ParentName）。いずれも事物そのもののクラス階層ではない。

**生成の位置。** 走っている世界での生成は、法則の効果（spawn）であり、量を源泉の資源から引く（釣り合い）。消滅（食べる、腐る）も効果である。種類の定義は雛形のデータで、初期配置と法則の効果の両方が同じ定義から作る。更新の外にあるのは初期配置と定義の登録だけで、Factory という別の仕組みは置かない。

<a id="decentral"></a>
### 関係から処理順が決まる更新：分散・並列の先行事例

2026-10-25、ユーザーの指摘を受けて調べた。「世界が親子の索引を持ち順序を決める」のは中央集権の発想で部分しか見ていない。相互作用には反応の**切っ掛けを出す側**と**受ける側**があり、影響範囲と合わせて関係をもっと普遍的に扱う必要がある。この種のシミュレーションで中央集権的なものは大体うまく行かない。事物の関係性から処理順が一意に決まり、どこから計算しても並列に計算してもうまく行く仕組みでないと、事物が少ないときは動いてもすぐ破綻する。先行事例を「順序はどこから来るか」「衝突はどこで解くか」「並列にできるか」で読んだ。

| 先行事例 | 原理 | 確認した一次資料 | ここへの含意 |
|---|---|---|---|
| Lamport 1978「時間、時計、事象の順序」 | 事象の順序は「先に起きた（happened before）」という因果の半順序だけで決まる。因果で結ばれない事象は同時で、どの順に処理しても同じ。論理時計が半順序に合う番号を与える | [原文 PDF](https://lamport.azurewebsites.net/pubs/time-clocks.pdf) | 順序を要するのは因果で結ばれた組だけ。中央の全順序は要らない |
| 並列離散事象シミュレーション（Fujimoto 1999、HLA） | 状態を持つ論理プロセスが時刻つきの事象を送り合う。**局所因果制約**: 各プロセスが自分の事象を時刻順に処理すれば全体が正しい。守り方は保守的（Chandy・Misra・Bryant の lookahead）か楽観的（Time Warp の巻き戻し） | [Fujimoto, WSC 1999](https://www.informs-sim.org/wsc99papers/016.PDF)、[HLA の時間管理](https://en.wikipedia.org/wiki/High-level_architecture) | 正しさの条件は局所。中央のスケジューラ無しに並列化できる |
| Petri net（Laurier・Poels、CPN） | 遷移が発火できるかは入力の店だけで決まる（局所性）。店を共有しない遷移は同時で、どの順に発火しても同じ。衝突は店を共有する遷移の間にだけあり、その店で解く | [Petri net の項](https://en.wikipedia.org/wiki/Petri_net)（並行性と衝突）、[第1節の記録](#rea) | 順序が要るのは同じ資源を取り合う組だけ。衝突の解決は資源のある場所に閉じる |
| アクターモデル（Hewitt 1973） | アクターは自分の状態を自分だけが持ち、相互作用はメッセージだけ。受け取った側が反応を決める。共有状態が無いので並列が前提 | [Hewitt・Bishop・Steiger, IJCAI 1973](https://www.ijcai.org/Proceedings/73/Papers/027B.pdf) | 切っ掛け（送る）と受ける（処理する）の分離。自分の値は自分が書く |
| 二段の取引（abcEconomics、Mars Sim、REA のコミットメント） | 申し出と受諾、予約と確定。資源の持ち主が受けるかを決める | [第7節の記録](#implementations)、[第1節の記録](#rea) | 衝突の解決を資源の持ち主に閉じる形。中央の整列を要しない |
| 同期更新（Jacobi）と逐次更新（Gauss・Seidel）、有限体積法 | 同期更新は古い値から全ての新しい値を計算し、順序に依らず並列にできる。逐次更新は新しい値を即座に使い、順序に依る。有限体積法は面ごとの流束を現在の状態から計算し、出た分が隣に入るので保存則が構成的に成り立つ | [Jacobi 法](https://en.wikipedia.org/wiki/Jacobi_method)、[有限体積法](https://en.wikipedia.org/wiki/Finite_volume_method) | 刻みの始めの状態から全組の流れを計算し、一斉に適用すれば順序独立。足りない分は源泉で縮める（流束制限） |
| 物理エンジンの島（Box2D） | 拘束で結ばれた物体の連結成分を島とし、島ごとに独立に（並列に）解く。島の中だけ反復で解く | [Box2D の simulation 文書](https://box2d.org/documentation/md_simulation.html) | 影響範囲のグラフの連結成分ごとに独立。島の中でも同期更新なら順序不要 |
| ECS のスケジューラ（Bevy、Unity） | System の実行順は宣言した読み書きの衝突から導き、衝突しない System は並列に走る | [Bevy の ECS 入門](https://bevyengine.org/learn/quick-start/getting-started/ecs/)、[Unity Entities](https://docs.unity3d.com/Packages/com.unity.entities@1.0/manual/concepts-intro.html) | 順序は中央の一覧ではなく、データの依存から導く |

**現状の評価。** いまの骨格は逐次更新（Gauss・Seidel 型）で、法則の順と事物の id 順という中央の規約で順序を決めている。保存則と決定性は保てているが、順序を中央が持つ点で、ユーザーの基準に照らすと破綻の芽である。

**候補の仕組み: 要求 → 解決 → 適用。** 先行事例を重ねると、一つの形に収束する。

1. **要求。** 刻みの始めの状態から、影響範囲にあるすべての組 (a, b) について法則が流れの要求を計算する。a は切っ掛けを出す側（意図、行為、変化の起点）、b は受ける側。読むだけなので並列にできる。
2. **解決。** 要求を資源の持ち主ごとに集め、持ち主が局所で解く。出す側は手持ちを超える要求を比例で縮め（流束制限）、受ける側は受容の上限（容量、札による拒否）で縮める。不可分な物（実一個）の取り合いは、その物に閉じた決定的な規則（要求者の札や関係で決まる優先、無ければ id）で一人に決める。事物ごとに独立なので並列にできる。
3. **適用。** 解決済みの流れを一斉に書く。順序に依らない。出た分が入るので保存則は構成的に成り立つ。

階層（付属）は関係の一種で、位置の継承は関係を辿る読み取り、親が消える連鎖は親の消滅が子に送る切っ掛けとして同じ枠で扱う。同じ刻みで生じた切っ掛けは次の刻みの要求になる（Lamport の因果、PDES の時刻順）。並列化は影響範囲のグラフの連結成分（島）ごとで、島の中も同期更新なら順序を要しない。中央に残るのは時計（Δt）と定義の表だけで、法則の順序の一覧は消える。

**代償。** 同期更新では同じ刻みの中の連鎖（移動してから採る、採ってから食べる）が次の刻みへ送られる。Δt が 10 分なら許容できる見込みだが、確かめる。逐次更新のほうが連鎖は速いが、順序に依る。

**検証の仕方。** 組の列挙順を入れ替えても（逆順、乱順）記録が同一であること、島ごとに別々に計算しても同一であること、保存則、決定性。これが「どこから計算しても並列でも同じ」の実証になる。

**実装した（2026-10-25、ユーザーの決定）。** `World.tick` の物理層を要求 → 解決 → 適用に置き換えた。法則の形 `pair(a, b, Δt)` は変えていない。不可分な物の優先は、当初は持ち主の関係 `favor`、要求者の札 `priority`、無ければ要求者の id とした。消す要求が通った事物に触れる他の要求は落とす（消す側が勝つ）。組を逆順・乱順に数えても最終状態と記録の集合が同一になることをテストで確かめた。代償として同じ刻みの連鎖は次の刻みへ送られ、果実の場面の結果は逐次更新のときとわずかに変わった（一人30日の採る回数 173 → 174）。

**解決の規則を物理量に改めた（2026-10-25、ユーザーの指摘）。** 「持ち主が決める」には二つの意味が混ざっていた。どこで解くか（資源の場所に閉じる局所性。Petri net の店、有限体積法のセル）は正しいが、何で決めるか（持ち主の関係 favor、要求者の札 priority）は上の表の「二段の取引」つまり経済・社会のモデルから来た既定で、物理の先行事例には無い。木に意思は無く、狩りの相手が「受けるか」を決めるのもおかしい。決めるのは、要求者が提供した運動（握る力、刃物、速さ）と対象の抵抗（結びつき、逃げる速さ）である。そこで不可分な物の取り合いは要求に載せた力の大きい順、同点は id とし、持ち主の意思（渡す）は解決の規則ではなく行為（法則）へ移した。可分な流れは要求がもともと能力 × Δt なので、比例で縮めるだけで強く引く者が多く取る形になっていた（[DESIGN の整理](DESIGN.md#physics-decides)）。

<a id="valueflows"></a>
## 2. ValueflowsとhREA――資源に結びついた過程

Valueflowsは、資源の仕様と具体的な資源、過程の入力・出力、意図・約束・実際の経済イベントを区別する。同じ過程に、計画と実績を関連付けられる。権利の移転と保管・占有の移転も区別する。これにより、資源の抽象名から、対象の実物とその変化へ降りられる。[公式モデル](https://www.valueflo.ws/specification/model-text/)、[過程](https://www.valueflo.ws/concepts/processes/)、[移転](https://www.valueflo.ws/concepts/transfers/)

ただし、ValueflowsのProcessだけで、実行途中の全手順、身体の吸収機構、割込みの制御まで決まるわけではない。このプロジェクトでは「パンを消費した」という実績に加え、摂取中・消化中・吸収済みという経過を必要な粒度で扱う。

### hREAのコードで確認できる区別

hREAはREA・Valueflowsの実装を明示する。確認版は `8c99160bbf6c4ffab0b4d05a3edf8ec629c09ab4`。次のリンクを固定し、後続の変更と混同しない。

| 対象 | 確認した内容 | このプロジェクトでの意味 |
|---|---|---|
| [ReaEconomicResource](https://github.com/h-REA/hREA/blob/8c99160bbf6c4ffab0b4d05a3edf8ec629c09ab4/dnas/hrea/zomes/integrity/hrea/src/rea_economic_resource.rs) | 仕様参照、所在、数量、責任主体などを資源に保持 | 「食品」という種類と、この場所にある食品を分ける |
| [組込みaction定義](https://github.com/h-REA/hREA/blob/8c99160bbf6c4ffab0b4d05a3edf8ec629c09ab4/dnas/hrea/zomes/coordinator/hrea/vf_actions/src/builtins.rs) | consume・use・produce等の効果、権利と保管の移転を区別 | 仕組みの定義は特定人物の在庫そのものではない |
| [経済イベントの処理](https://github.com/h-REA/hREA/blob/8c99160bbf6c4ffab0b4d05a3edf8ec629c09ab4/dnas/hrea/zomes/coordinator/hrea/src/rea_economic_event.rs) | 実イベントの対象と効果定義を関連付けて数量等へ反映 | 定義と実物が結びつく適用箇所が必要 |
| [受入シナリオ](https://github.com/h-REA/hREA/blob/8c99160bbf6c4ffab0b4d05a3edf8ec629c09ab4/clients/acceptance/src/scenarios/rea-flows.ts) | 生産・増減・消費を通した残量の検査コード | 最終値だけでなく変化の対応を検査する例。実行は未確認 |

hREAは実資源を調整・記録するシステムであり、自然法則を自律計算する生活シミュレータではない。produceの記録が作れることと、投入物から物理的に生産できることは別である。

<a id="rea-reuse"></a>
### REAの実装はどこまで使えるか

2026-10-24に、上記の実装を「入手できる形」「取り込める部分」「取り込めない部分」で照合した。結論は、**語彙・型・action効果表・不変条件は直接採り、実行系は採らない**。この照合の前に独自の大構造を書き始めたのは順序の誤りだった。

| 対象 | 入手できる形 | 取り込める部分 | 取り込めない部分 | 判断 |
|---|---|---|---|---|
| Laurier・Poels 2013 | 著者稿の全文。モデルファイルとExSpecTは入手不可 | 表1の不変条件（流入・流出、消費と生産の対、責任者、二者）。公理違反をモデル境界の印にする読み方。事象＝資源を変える遷移、在庫＝店、約束＝未履行の店、情報＝調整用トークンという離散事象の構造 | 健全な代謝の前提。身体・自然過程・速度。コード | 不変条件と事象構造を骨格に採る |
| MAREA | 論文のみ | REAのERPに主体を載せて商社が動き、イベントログが出るという先例の確認 | コード・配布物が無い | 参照のみ |
| Valueflows仕様と[vf-graphql](https://www.npmjs.com/package/@valueflows/vf-graphql) | 公開仕様。TypeScript型定義 `@valueflows/vf-graphql` 0.9.1-alpha.4（Apache-2.0、`index.d.ts` 約1,100行、リポジトリは lab.allmende.io） | 型: EconomicResource（onhand/accounting量、primaryAccountable、currentLocation、containedIn、stage/state、lotと期限）、EconomicEvent（action、provider/receiver、resourceInventoriedAs/toResourceInventoriedAs、量、時刻、inputOf/outputOf、atLocation/toLocation）、Process（hasBeginning/hasEnd/finished、観測・約束・意図の入出力）、ResourceSpecification、ProcessSpecification、Commitment、Intent、Agreement、Claim、SpatialThing、ProductBatch。意図→約束→実績の区別。[action一覧](https://www.valueflo.ws/concepts/actions/) | 仕様が「定義しない」と明言する物理的変換の速度と予定。知覚・身体・時間進行。GraphQL/DB層。仕様本文のライセンスは未確認 | 骨格の語彙と型として直接採る。必要な部分型だけを写し、GraphQL層は採らない |
| hREA（固定commit） | Rust、Holochain、Apache-2.0 | action効果表（21種、accounting/onhandの増減、入出力、対。約150行の純データ）。`apply_effect` の規則、produce/raiseでの資源生成、fulfills/satisfies/settlesの対応付け。受入シナリオ（TypeScript約240行）の流れ | Holochainランタイム。負量・単位不一致・二資源間のtransfer/move・所在と保管の更新が未実装。検査は終値のみで失敗例が無い | 効果表と規則を移植する。ランタイムと検査の薄さは引き継がない |

この照合から、[大きな構造](DESIGN.md#structure)の部品はREA/Valueflowsの語彙に対応づけられる。足すものは三つに限られる。身体を資源として世界に置くこと、法則に速度・上限・変換比と時間進行を持たせること、人物の心象（知覚・記憶）を加えること。この三つはValueflowsとLaurier・Poelsのどちらも扱っていない。

<a id="allocation-hints"></a>
### 供給と配分の構造への実装のヒント

ユーザーの指摘（2026-10-24）で、問題の本質は「世界が資源をどう供給し、人物が不完全な心象で供給を予測し、自分の手段を配分して取得し、結果で心象を更新するか」であり、本調査はその構造を表に出していなかった。個別の区別（資源・過程・責任）は正しいが、個体の適応の環として読んでいなかった。読み直すと、調査資料には実装の手掛かりがある。

| 手掛かり | 確認した内容 | 大構造での位置 |
|---|---|---|
| Valueflowsの三層 | 公式序文は Knowledge（分類・方針・手順・規則・型）、Plan（提示と要求、予定、約束）、Observation（実際に起きたこと）の三層を定義する。[序文](https://www.valueflo.ws/introduction/core/)。Recipe系はKnowledge層の部品、Plan・Intent・Commitment・ProposalはPlan層、EconomicEvent・EconomicResourceはObservation層、Processは計画と観測の両方に存在し得る（[モデル説明](https://www.valueflo.ws/specification/model-text/)） | 心象の知識部分＝Knowledge層の本人用の写し。予測・配分の出力＝Plan層。実結果＝Observation層。心象の信念＝最後に観測したObservationの写し（時刻・出所つき） |
| Laurier・Poelsの在庫方針 | 在庫管理は所定の頻度で在庫を調べ、発注点を下回れば経済発注量を発注する。注文・請求は情報トークンとして遅れて届き、未着注文と受注残は約束を表す店に置かれる | 最小の予測・配分規則。遅れた情報で動く心象。期待される流入＝Commitment。最初の骨格の人物はこの程度でよい |
| Beer Gameの結果 | 局所的な在庫方針と情報の遅れから、上流ほど在庫が振れるbullwhipが生じ、発注頻度を変えると消える | 個体の適応の総和が世界の配分になることの先例。心象と実状態のずれが系全体の挙動を作る |
| abcEconomics | 主体が自分の在庫と予約量を持ち、投入可能量を確認してから生産・取引する | 自分の手段の予算と、その範囲での配分 |
| Mountaincore | 目標ごとに具体的な食品・物品を割り当て、確保・解放する | 配分の対象は仕様ではなく実物 |
| 経済理論 | 情報の非対称、観察できない行動、不完備契約 | 心象は実状態の複写ではなく、約束は履行と別 |
| 既存の数表 | [5人の90日の実行可能性](baseline/AUTONOMOUS_90_DAY_FEASIBILITY.md)は食料・薪・通貨・時間の供給と需要の算術 | 世界の供給が需要を満たし得るかの境界条件。人物の判断を含まない |

抜けていたのは、これらを供給・心象・予測・配分・実結果という一つの環として読むことだった。この環を大構造に置くと、HMOSAICを含む判断方式は「予測・配分」の差し替え可能な中身になり、知覚仕様は「心象の更新経路」の細部になり、法則の係数は「供給の速度」の細部になる。

<a id="ddd"></a>
## 3. DDD――状態と不変条件の責任境界

EvansのDDDには、同一性を持つEntity、整合性を保つAggregate、特定のEntityへ自然に属さない操作を扱うService、計算機構を分離するCohesive Mechanismsがある。確認したのは著者の *DDD Reference* の各該当項目である。[著者の案内](https://www.domainlanguage.com/ddd/reference/)、[参照文書](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf)

ここから得るのは「人物や世界に、状態と整合性を取りまとめる責任を持たせられる」「物理計算の共用と、資源を持つ実体の責任を分けられる」という設計上の足場である。世界全体を一つのDBトランザクションやAggregateにする結論は導かれない。DDDは世界の存在論でも物理法則でもない。

クラスは、その責任をアクセス制御・構築条件・操作の入口として強制する有力な形式である。しかし、同じ可変状態を別経路から変更できれば、クラス名だけでは制約にならない。「担当者が毎回正しく判断する」ことへの依存を減らすには、許す操作と拒む操作を明記し、実装時に境界を強制する必要がある。

<a id="other-modeling"></a>
## 4. カラーモデリング・TM・イベントソーシング

| 理論 | 確認した区別・根拠 | 利用する範囲と限界 |
|---|---|---|
| Coadらのカラーモデリング | 4類型は緑Party/Place/Thing、黄Role、青Description、桃Moment-Interval。[著者書籍の出版社案内](https://www.informit.com/store/java-modeling-in-color-with-uml-enterprise-components-9780130115102)、[公開第5章](https://www.informit.com/content/images/013011510X/samplechapter/013011510X.pdf) | 人・物・場所、役割、記述、時間を持つ活動を分ける。公開章には要求・活動・テンプレートや資源の確保・解放を扱う例がある。全ソースや生活世界への適用は未確認 |
| TM（T字形ER手法） | 考案者の佐藤正美氏が、実装上の無矛盾と事業の事実への対応、関係・制約の把握を区別する。[考案者へのインタビュー](https://www.sei-info.co.jp/framework/column/data-modeling/) | 資源と出来事を関係から見直す手掛かり。「resource」の語義は物理的な消費物に限定されず、こちらの資源定義と同一ではない。モデルが形式的に整っても対象現象を捉えた証明にはならない |
| イベントソーシング | 状態の変化をイベントとして保存し、再適用で状態を再構成する。[Fowlerの解説](https://martinfowler.com/eaaDev/EventSourcing.html) | 実際の変化の追跡・再現に使える保存方式。イベントという存在の区別とは別。全履歴保存を大構造の必須条件にしない |

色の分類は「緑が人物、黄が物」ではなく、人物と物は同じ緑、黄は役割である。この区別は、身体を持つ人物と、売り手・所有者などの社会的役割を同一視しないために有用である。

<a id="ontology"></a>
## 5. 存在論――もの・性質・可能性・過程

BFOは、時間を通じて存在を保つものと、時間に展開する過程を分け、物的実体、性質、傾向性、役割、参加・実現の関係を扱う。BFO 2020はISO/IEC 21838-2:2021に対応する公開成果物を持つ。確認対象は公式案内と公開定義であり、標準全文の精査ではない。[公式案内](https://bfo-ontology.github.io/bfo-2020.html)、[公開コア定義](https://github.com/BFO-ontology/BFO-2020/blob/master/21838-2/owl/bfo-core.ofn)

これを参考に、次を区別する。

- 身体・パン・かまどなどの実体と、重さ・温度・栄養状態などの性質。
- 身体や設備が条件下で発揮できる能力と、実際に起きている摂食・加熱などの過程。
- 売り手・雇用主・所有者などの役割と、その役割を担う人物。
- 過程の種類・説明と、特定の時刻・場所・参加者に結びついた一回の過程。

**法則、能力、種類の定義、過程の実例は別物**である。法則は変化を拘束する関係、能力は実体に備わる可能性、過程は条件下で実際に起きる変化である。BFOの傾向性を物理法則そのものと同一視したり、BFOだけで所有権や判断の全構造が定まるとしたりはしない。この区別をこちらの資源・作用モデルへどう対応させるかは設計判断である。

<a id="economics"></a>
## 6. 経済理論――権利・知識・利害の異なる人物の相互作用

これらは同じ階層の理論ではない。資源・出来事・主体の基本構造の上に、契約・情報・誘因に関する条件を置き、特定の現象を説明する。欺瞞や最適化を全人物の本性として埋め込む根拠にはしない。

| 理論・現象 | 中立的な説明 | 世界・人物・資源への接点 |
|---|---|---|
| プリンシパル＝エージェント理論 | 委任関係で、利害や利用できる情報が異なるときの契約・誘因 | 依頼と受諾、実作業、監視できる結果、報酬を分ける |
| モラルハザード | 契約後などに行動が十分観察できず、誘因が結果に影響する問題 | 行為の真相と相手が得た観察証拠が異なる。不道徳や嘘に限定しない |
| 逆選抜 | 契約前の属性・品質などの私的情報と、取引相手の選択が関係する問題 | 食品の品質の実状態、売り手の知識、買い手の推定を区別する |
| 不完備契約理論 | 将来の状態や行動のすべてを契約・第三者検証の対象にできない条件での権利配分 | 所有と残余の決定権、約束にない事態、実際の処分を扱う |
| ホールドアップ | 他の用途へ転用しにくい投資の後、交渉条件が変化し得る問題 | 設備・技能・立地の特定相手への依存と、投資前後の交渉力 |
| シグナリング | 情報を持つ側の行動が相手の推定を変える。型による費用差などが重要 | 支払った費用・観察された行動・受け手の推論を分ける。高価な行為だけで誠実さは証明されない |
| スクリーニング | 情報の乏しい側が条件や選択肢を設け、相手の選択から情報を得る | 提示条件、本人の選択、得られる証拠。罠や欺瞞を必須にしない |
| 取引費用理論 | 探索・交渉・監視・執行などの費用と、企業内調整を含む統治方式の比較 | 移動・調査・契約・監督も時間と能力を使う過程。市場にも組織にも費用がある |

一次資料の入口は、[2001年の情報非対称性に関する受賞説明](https://www.nobelprize.org/prizes/economic-sciences/2001/press-release/)、[2016年の契約理論の科学的背景](https://www.nobelprize.org/uploads/2018/06/advanced-economicsciences2016-1.pdf)、[Williamson本人による研究の説明](https://www.nobelprize.org/prizes/economic-sciences/2009/williamson/biographical/?frame=0)。Nobel資料には直接取得が403になるものがあり、検索で取得できた公開説明・抜粋の範囲を参照した。原論文を全件精査した一覧ではなく、形式モデルの仮定や均衡の採用は未決である。

この調査から採るのは、社会的権利と物理的な制御、真の状態と相手の知識、約束と履行を分ける必要性である。雇用、契約均衡、欺瞞行動等を今回の実装項目へ追加するものではない。

<a id="implementations"></a>
## 7. 他の実装――資源の保持と仕組みの適用はどこで結びつくか

### abcEconomics：人物に相当する主体の資源と共用機構

確認版は `adb9e137abe496f71eedb7885a0d860dbf8384d3`。Inventoryは実際の保有量と予約量を持ち、GoodsやFirmは投入・生産・消費を扱う。Traderは売買に伴う予約等を扱う。生産関数の仕組みを渡すことと、特定主体の投入可能量を確認して実在庫を変えることが分かれている。REA・DDDを明示採用したとの確認はなく、構造の比較例である。[公式リポジトリ](https://github.com/AB-CE/abce)

| 確認箇所 | 参考になる点 | 限界 |
|---|---|---|
| [Inventory](https://github.com/AB-CE/abce/blob/adb9e137abe496f71eedb7885a0d860dbf8384d3/abcEconomics/inventory.py) | 所持と予約、数量不足の検査 | createでの生成はモデル作成者が管理する必要がある |
| [Goods](https://github.com/AB-CE/abce/blob/adb9e137abe496f71eedb7885a0d860dbf8384d3/abcEconomics/agents/goods.py)、[Firm](https://github.com/AB-CE/abce/blob/adb9e137abe496f71eedb7885a0d860dbf8384d3/abcEconomics/agents/firm.py) | 共用する変換の仕組みを具体的な投入在庫へ適用 | あらゆる生産が身体・自然法則に基づく保証はない |
| [Trader](https://github.com/AB-CE/abce/blob/adb9e137abe496f71eedb7885a0d860dbf8384d3/abcEconomics/agents/trader.py) | 提示・予約・受諾・移転の関係 | 物理的な輸送時間や身体生活をそのまま得られるわけではない |

### コロニー・身体シミュレーション：定義、実物、進行中の作用

| 実装・固定した版 | 対象箇所で確認した構造 | 採用時に注意する点 |
|---|---|---|
| [Mountaincore](https://github.com/rossturner/mountaincore/tree/08afcf6d276f0d4a75c14bf34e02d169a4322ea8) | InventoryComponent、ItemAllocationComponent、FoodAllocation、AssignedGoal、ConsumeFoodAction。所持品・数量割当て・食事行動の進行を関連付ける | 一連の動作に具体的な食品と確保・解放が必要という例。クラス分割だけで全更新権限が限定されているとは言えない |
| [Mars Sim](https://github.com/mars-sim/mars-sim/tree/6ee62e85b11912a4f56759b6a7fd02aca25856a5) | Personが身体・Mind・所持設備を持つ。ResourceProcessSpecは変換の仕様、ResourceProcessは設備側の資源保持者に結びついた実行、MicroInventoryは実量と容量を扱う | 仕様と、資源を使う実行の区別が参考になる。仕様クラスは設定状態を持ち得るため「完全な純粋関数」とはしない |
| [KeeperRL](https://github.com/miki151/keeperrl/tree/95d2be4e97db2243210a71918e36a533ad94dcd1) | Equipmentの実物管理と、CreatureActionに束縛された対象・実行・失敗を区別 | 行動の説明だけでは作用しないことが参考になる。Creatureが多くの処理を取りまとめること自体を欠陥とはしない |

外部実装はソースの対象箇所のみを確認し、実行・ビルド・受入試験は未実施。[以前のコロニー系調査](foundations/COLONY_SIM_ARCHITECTURE_REVIEW.md)は追加の探索資料として残すが、新しい原則の正本とはしない。

## 8. 何を採り、何を留保するか

採るのは次の関係である。これらを実装上のクラス名や保存形に直結させず、[設計原則](DESIGN.md)で現象の制約として定義する。

| 採る関係 | 主な根拠 | 原則 |
|---|---|---|
| 世界内の実物と、それに関わる人物 | REA、存在論、身体を持つシミュレーション | [P01](DESIGN.md#p01)、[P02](DESIGN.md#p02) |
| 仕組みの定義と、対象・条件に結びついた具体的な作用 | Valueflows、Mars Sim、abcEconomics | [P03](DESIGN.md#p03)、[P06](DESIGN.md#p06)、[P07](DESIGN.md#p07) |
| 資源の管理、社会的権利、物理的な制御、整合性の責任 | DDD、Valueflows、契約理論 | [P04](DESIGN.md#p04)、[P10](DESIGN.md#p10)、[P12](DESIGN.md#p12) |
| 実状態、知識、意図、約束、履行の区別 | REA、Valueflows、情報・契約の経済理論 | [P05](DESIGN.md#p05)、[P06](DESIGN.md#p06)、[P10](DESIGN.md#p10) |
| 資源制約と、身体・環境・人物間の相互作用 | 具体的な在庫管理、身体・生活シミュレーション | [P07](DESIGN.md#p07)、[P08](DESIGN.md#p08)、[P09](DESIGN.md#p09) |
| 変化の証拠と版別の検証 | REAのシミュレーション、イベントソーシング、既存の比較実験 | [P11](DESIGN.md#p11) |

留保するのは、唯一の普遍的クラス階層、全世界を覆う単一の経済モデル、全人物の合理性・欺瞞・交換成功、全資源を同じ数量として扱うこと、特定の保存・実行方式の必須化である。

確認範囲では、REAを使った経済シミュレーションと、資源・身体・作用を扱う別の実装は見つかった。一方、それらを統合し、このプロジェクトの自律生活・身体・主観まで満たす完成済みの雛形は確認できていない。外部構造の丸写しではなく、根拠のある区別と反例を用いて制約を確立する。

## 更新する条件

原則の変更を支える新しい根拠、既存解釈への反例、実装から判明した関係の不足があるときに更新する。出典、確認範囲、こちらの推論、採用・留保を同じ場所に記す。調査の追加だけで本文を増やさず、既存の区別を修正するか、今回の設計に必要な未解決点を埋める。

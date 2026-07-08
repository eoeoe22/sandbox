# 물질 도감 (Materials)

전체 물질과 핵심 상호작용 요약. 팔레트는 아래 카테고리 탭으로 묶인다(각 물질의
`category` 필드, 생략 시 `phase` 에서 자동 유도).

> `Eraser`(지우개), `Ember`(불씨), `Spark`(스파크)는 팔레트에 없다: 앞의 둘은
> 폭발 파편/전기 펄스로 시뮬레이션이 스스로 생성하는 일시적 입자다.

## 🪨 고체 (Solid)

| 물질 | 거동 / 상호작용 |
|---|---|
| Wall | 파괴 불가 경계. 폭발·산·Void 모두 못 뚫음. |
| Stone | 정적 장벽. 1100°↑ → Lava 로 용융. |
| Glass | 투명. 내산성. 1250°↑ → Molten Glass 로 재용융. |
| Concrete | Cement + 물이 굳은 결과물. 강하지만 폭발·산에 취약. |

## 🏖️ 가루 (Powder)

| 물질 | 거동 / 상호작용 |
|---|---|
| Sand | 낙하·퇴적. 1250°↑ → Molten Glass. |
| Salt | 물에 용해 → Saltwater. |
| Dirt | 물 흡수 → Mud. Moss 가 덮는 지반. |
| Cement | 물 접촉 → Concrete 로 경화(물 소모). |
| Rust | Iron 이 산화한 부스러기. 산에 잘 녹음. |
| Ash | 연소 잔재. 아주 가벼워 물에 뜬다. |

## 💧 액체 (Liquid)

| 물질 | 밀도 | 거동 / 상호작용 |
|---|---|---|
| Water | 3 | 100° 끓음→Steam, 0°↓ 얼음/눈. |
| Saltwater | 4 | 물보다 무겁게 가라앉음. 끓으면 소금 석출. |
| Acid | 3 | 비내산성 고체·가루 부식. 끓으면 Acid Vapor. |
| Mercury | 9 | 가장 무거운 액체. **전기 도체**(스파크 전달). |
| Honey | 3.5 | 점성 높아 천천히 흐름. 느리게 타는 연료. |
| Alcohol | 1.9 | 가장 가벼운 연료. 순식간에 옮겨붙어 확 탄다. |
| Mud | 5.5 | 젖은 흙. 마르면 Dirt 로 굳음. |

## 💨 기체 (Gas)

| 물질 | 거동 / 상호작용 |
|---|---|
| Steam | 상승 후 응결 → Water. |
| Smoke | 상승 후 확률 소멸. |
| Acid Vapor | 상승하며 부식, 응결 → Acid. |
| Oxygen | 불 접촉 시 자신도 불로 확 번짐(가속제). |
| CO₂ | **무거워서 가라앉음**. 낮은 곳에 고여 불을 질식시킴. Dry Ice/LN₂ 에서 발생. |

## 🔥 불·열 (Fire / Heat)

| 물질 | 거동 / 상호작용 |
|---|---|
| Fire | 가연물 점화, 물에 소화. |
| Blue Flame | 초고온. 돌을 녹여 Lava 로. |
| Lava | 용융 암석. 식으면 Stone. |
| Molten Metal | Iron 이 녹은 것. 식으면 Iron. 최고 밀도(8) 액체. |
| Molten Glass | Sand 가 녹은 것. 식으면 Glass. |
| Coal / Wood / Sawdust / Crude Oil / Gasoline | 연료(느림→빠름 순: Coal < Wood < Sawdust < Oil < Gasoline). |

## 💥 폭발 (Explosive)

| 물질 | 거동 / 상호작용 |
|---|---|
| Gunpowder | 가루 폭약. 물에 젖으면 불발. 연쇄 기폭. |
| Nitro | 액체 폭약. 대반경, 물 무관. |
| Methane | 공기-연료 폭발 기체. |
| Hydrogen | 가장 가볍고 격렬. 저온 점화·대반경. Oxygen 과 만나면 대폭발. |
| TNT | 고체 대형 폭약(반경 8). 스파크/불/열로 기폭. |
| Fuse | 가장 느린 도화선. 불을 천천히 폭약까지 운반. |
| Thermite | 점화 시 초고온으로 지형을 뚫으며 녹임 → Molten Metal 잔류. |
| Blast | 폭발 충격파(직접 배치 가능). |

## ❄️ 냉각 (Cryo)

| 물질 | 거동 / 상호작용 |
|---|---|
| Ice | 고체 얼음. 녹으면 Water. |
| Snow | 가벼운 가루 눈. |
| Liquid N₂ | -196°. 냉각원. 물을 얼리고 불을 끔. 데워지면 CO₂. |
| Dry Ice | -78°. 승화 → CO₂. |

## ⚡ 전기 (Electric)

| 물질 | 거동 / 상호작용 |
|---|---|
| Iron | 최고 열전도 + **전기 도체**. 1400°↑ 용융. 물에 서서히 녹슬어 Rust. |
| Battery | 주기적으로 인접 도체에 Spark 주입 → 자가 구동 회로. |
| (Spark) | 도체를 타고 전파하는 전기 펄스. 폭약·연료 점화. 불응 처리로 역류 방지. |

## 🌱 생명 (Life)

| 물질 | 거동 / 상호작용 |
|---|---|
| Seed | 물 있으면 발아 → Vine. |
| Vine | 물 소비하며 위로 성장. |
| Moss | 습기 있으면 인접 표면(돌·흙·나무·콘크리트)을 덮으며 번짐. 가연성. |
| Virus | 유기물·흙·물을 감염시켜 전파. 불·산·열로 치료. |

## ✨ 특수 (Exotic)

| 물질 | 거동 / 상호작용 |
|---|---|
| Clone | 처음 닿은 물질을 복제해 무한 방출(무한 소스). |
| Void | 닿는 모든 물질 삭제(무한 싱크, Wall 제외). |
| Antimatter | 물질 접촉 시 1:1 상호소멸 + 화염 섬광. |

## 대표 상호작용 사슬

- **금속 주조:** Iron → (열) → Molten Metal → (냉각) → Iron. Water 부으면 Steam 으로 냉각.
- **유리 공예:** Sand → (열) → Molten Glass → (냉각) → Glass.
- **전기 기폭:** Battery → Iron/Mercury 배선 → Spark → 아크 불꽃 → Gunpowder/TNT 기폭.
- **도화선 폭파:** Fire → Fuse(지연) → TNT 연쇄.
- **소방:** Dry Ice/LN₂ → CO₂ 가 낮은 곳에 고여 불을 질식.
- **절단:** Thermite 점화 → 돌·철·유리를 뚫으며 녹여 Molten Metal 잔류.
- **폭연:** Spark → Hydrogen/Oxygen 혼합 기체 → 대폭발.
- **생태계:** Water + Dirt → Mud, Seed → Vine, Moss 가 습한 표면을 덮음, Virus 가 유기물을 감염.
- **소스/싱크:** Clone(무한 생성) ↔ Void(무한 삭제) 컨베이어.

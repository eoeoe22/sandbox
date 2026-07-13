// 오브젝트 barrel — materials/index.ts와 같은 규약. 이 모듈을 import하면 모든
// 오브젝트 타입이 부수효과로 등록된다. 타입 추가 = 파일 만들고 여기 두 줄.
export * from './registry';
export * from './types';

import { RUBBER_BALL } from './rubberball';
import { BEACH_BALL } from './beachball';
import { OIL_DRUM } from './oildrum';
import { ACID_DRUM } from './aciddrum';
import { METHANE_TANK } from './methanetank';
import { DYNAMITE } from './dynamite';
import { BALLOON } from './balloon';

export { RUBBER_BALL, BEACH_BALL, OIL_DRUM, ACID_DRUM, METHANE_TANK, DYNAMITE, BALLOON };

/** 팔레트에 표시되는 오브젝트들, 표시 순서대로. */
export const OBJECTS = [RUBBER_BALL, BEACH_BALL, BALLOON, OIL_DRUM, ACID_DRUM, METHANE_TANK, DYNAMITE];

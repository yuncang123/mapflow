# 实现父子地图回执

## State transition

从父边只能由手工 Evidence 证明，抵达父边可绑定独立子地图，并仅由已到达、验收完整、摘要匹配的子图回执证明 effects。

## Scope

- Submap Binding 校验与 `verify-submap`。
- Receipt 追加、stale 判断和父级到达门。

## Evidence contract

- arrived 成功测试。
- 未到达、Acceptance 不完整、map digest/state revision stale 反例。

## Failure

replan

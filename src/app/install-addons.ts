export const installAddons = [
  {
    id: 'fabric-api',
    title: 'Fabric API',
    desc: '许多 Fabric 模组的基础依赖',
    loaders: ['fabric'],
  },
  { id: 'sodium', title: 'Sodium', desc: '改善渲染性能', loaders: ['fabric', 'neoforge'] },
  {
    id: 'jei',
    title: 'Just Enough Items',
    desc: '查看物品与配方',
    loaders: ['fabric', 'quilt', 'forge', 'neoforge'],
  },
  {
    id: 'jade',
    title: 'Jade',
    desc: '查看方块与实体信息',
    loaders: ['fabric', 'quilt', 'forge', 'neoforge'],
  },
];

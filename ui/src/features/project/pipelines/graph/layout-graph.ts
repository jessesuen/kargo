import { graphlib } from '@dagrejs/dagre';

import { RepoSubscription, WarehouseExpanded } from '@ui/extend/types';
import { ColorMap } from '@ui/features/stage/utils';
import { Stage, Warehouse } from '@ui/gen/api/v2/models';

import { repoSubscriptionIndexer, stageIndexer, warehouseIndexer } from './node-indexer';
import { repoSubscriptionLabelling, stageLabelling, warehouseLabelling } from './node-labeling';
import { repoSubscriptionSizer, stageSizer, warehouseSizer } from './node-sizer';

export type GraphMeta = {
  warehouse?: WarehouseExpanded;
  subscription?: RepoSubscription;
  stage?: Stage;
  subscriptionParent?: Warehouse;
  value?: number;
  id?: string;
  parentNodeId?: string;
};

export const layoutGraph = (
  stage: {
    stages: Stage[];
    ignore?: (s: Stage) => boolean;
  },
  warehouse: {
    warehouses: WarehouseExpanded[];
    ignore?: (w: WarehouseExpanded) => boolean;
  },
  warehouseColorMap?: ColorMap,
  hideSubscriptions?: Record<string, boolean>
) => {
  const graph = new graphlib.Graph<GraphMeta>({ multigraph: true });

  graph.setGraph({ rankdir: 'LR', ranksep: 150, nodesep: 60 });
  graph.setDefaultEdgeLabel(() => ({}));

  const warehouseByName: Record<string, WarehouseExpanded> = {};
  const stageByName: Record<string, Stage> = {};

  for (const w of warehouse.warehouses) {
    warehouseByName[w?.metadata?.name || ''] = w;
  }

  for (const s of stage.stages) {
    stageByName[s?.metadata?.name || ''] = s;
  }

  const maxStageHeight = 200;
  // A Warehouse and its subscriptions are laid out a little tighter than the
  // cards themselves, which are about 85px. A project may have dozens of
  // Warehouses, and spacing each a Stage apart stretches the column far past
  // the Stages it feeds; the gap between nodes still keeps them apart.
  const warehouseRowHeight = 80;

  for (const w of warehouse.warehouses) {
    if (warehouse.ignore?.(w)) {
      continue;
    }

    const warehouseNodeIndex = warehouseIndexer.index(w);
    graph.setNode(warehouseNodeIndex, {
      ...warehouseLabelling.label(w),
      ...warehouseSizer.size(),
      height: warehouseRowHeight
    });

    if (hideSubscriptions?.[w?.metadata?.name || '']) {
      continue;
    }

    for (const s of w.spec?.subscriptions || []) {
      const subscriptionNodeIndex = repoSubscriptionIndexer.index(w, s);

      graph.setNode(subscriptionNodeIndex, {
        ...repoSubscriptionLabelling.label(w, s),
        ...repoSubscriptionSizer.size(),
        height: warehouseRowHeight
      });

      graph.setEdge(subscriptionNodeIndex, warehouseNodeIndex);
    }
  }

  for (const s of stage.stages) {
    if (stage.ignore?.(s)) {
      continue;
    }

    const stageNodeIndex = stageIndexer.index(s);

    graph.setNode(stageNodeIndex, {
      ...stageLabelling.label(s),
      ...stageSizer.size(),
      height: maxStageHeight
    });

    for (const requestedOrigin of s.spec?.requestedFreight || []) {
      const warehouseName = requestedOrigin?.origin?.name || '';

      const warehouseData = warehouseByName[warehouseName];

      if (warehouse.ignore?.(warehouseData)) {
        continue;
      }

      const warehouseNodeIndex = warehouseIndexer.index(warehouseByName[warehouseName]);

      const edgeColor = warehouseColorMap?.[warehouseName];

      if (requestedOrigin?.sources?.direct) {
        graph.setEdge(warehouseNodeIndex, stageNodeIndex, { edgeColor }, warehouseNodeIndex);
      }

      for (const sourceStage of requestedOrigin?.sources?.stages || []) {
        graph.setEdge(
          stageIndexer.index(stageByName[sourceStage]),
          stageNodeIndex,
          { edgeColor },
          warehouseNodeIndex
        );
      }
    }
  }

  return { graph, stageByName, maxStageHeight };
};

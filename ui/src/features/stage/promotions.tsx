import { createClient } from '@connectrpc/connect';
import { createConnectQueryKey, useQuery } from '@connectrpc/connect-query';
import { useQueryClient } from '@tanstack/react-query';
import { Spin, Table, Tooltip } from 'antd';
import { ColumnsType } from 'antd/es/table';
import { format } from 'date-fns';
import React, { useEffect, useState } from 'react';
import { Link, generatePath, useParams } from 'react-router-dom';

import { paths } from '@ui/config/paths';
import { transportWithAuth } from '@ui/config/transport';
import { PromotionStatusIcon } from '@ui/features/common/promotion-status/promotion-status-icon';
import {
  getPromotionStatusPhase,
  isPromotionPhaseTerminal
} from '@ui/features/common/promotion-status/utils';
import {
  getFreight,
  listPromotions
} from '@ui/gen/api/service/v1alpha1/service-KargoService_connectquery';
import { ListPromotionsResponse } from '@ui/gen/api/service/v1alpha1/service_pb';
import { KargoService } from '@ui/gen/api/service/v1alpha1/service_pb';
import { ArgoCDShard } from '@ui/gen/api/service/v1alpha1/service_pb';
import { Freight, Promotion } from '@ui/gen/api/v1alpha1/generated_pb';
import uiPlugins from '@ui/plugins';
import { UiPluginHoles } from '@ui/plugins/atoms/ui-plugin-hole/ui-plugin-holes';
import { timestampDate } from '@ui/utils/connectrpc-utils';

import { PromotionDetailsModal } from './promotion-details-modal';
import { hasAbortRequest, promotionCompareFn } from './utils/promotion';

export const Promotions = ({ argocdShard }: { argocdShard?: ArgoCDShard }) => {
  const client = useQueryClient();

  const { name: projectName, stageName } = useParams();
  const { data: promotionsResponse, isLoading } = useQuery(
    listPromotions,
    { project: projectName, stage: stageName },
    { enabled: !!stageName }
  );

  const [curFreight, setCurFreight] = useState<string | undefined>();

  const { data: freightData, isLoading: isLoadingFreight } = useQuery(
    getFreight,
    { project: projectName, name: curFreight },
    {
      enabled: !!curFreight
    }
  );

  // modal kept in the same component for live view
  const [selectedPromotion, setSelectedPromotion] = useState<Promotion | undefined>();

  useEffect(() => {
    if (isLoading || !promotionsResponse) {
      return;
    }
    const cancel = new AbortController();

    const watchPromotions = async () => {
      const promiseClient = createClient(KargoService, transportWithAuth);
      const stream = promiseClient.watchPromotions(
        { project: projectName, stage: stageName },
        { signal: cancel.signal }
      );

      let promotions = (promotionsResponse as ListPromotionsResponse).promotions || [];

      for await (const e of stream) {
        const index = promotions?.findIndex(
          (item) => item.metadata?.name === e.promotion?.metadata?.name
        );
        if (e.type === 'DELETED') {
          if (index !== -1) {
            promotions = [...promotions.slice(0, index), ...promotions.slice(index + 1)];
          }
        } else {
          if (index === -1) {
            promotions = [...promotions, e.promotion as Promotion];
          } else {
            promotions = [
              ...promotions.slice(0, index),
              e.promotion as Promotion,
              ...promotions.slice(index + 1)
            ];
          }
        }

        // Update Promotions list
        const listPromotionsQueryKey = createConnectQueryKey({
          cardinality: 'finite',
          schema: listPromotions,
          input: {
            project: projectName,
            stage: stageName
          },
          transport: transportWithAuth
        });
        client.setQueryData(listPromotionsQueryKey, { promotions });
      }
    };
    watchPromotions();

    return () => cancel.abort();
  }, [isLoading]);

  const promotions = React.useMemo(() => {
    // Immutable sorting
    return [...(promotionsResponse?.promotions || [])].sort(promotionCompareFn);
  }, [promotionsResponse]);

  const columns: ColumnsType<Promotion> = [
    {
      title: '',
      width: 24,
      render: (_, promotion) => {
        const isAbortRequestPending =
          hasAbortRequest(promotion) &&
          !isPromotionPhaseTerminal(getPromotionStatusPhase(promotion));

        // generally controller quickly Abort promotion
        // but incase if controller is off for some reason, this messaging ensures accurate information
        if (isAbortRequestPending && promotion?.status) {
          promotion.status.message = 'Promotion Abort Request is in Queue';
        }

        return (
          <PromotionStatusIcon
            status={promotion.status}
            color={isAbortRequestPending ? 'red' : ''}
          />
        );
      }
    },
    {
      title: 'Date',
      render: (_, promotion) => {
        const date = timestampDate(promotion.metadata?.creationTimestamp);
        return date ? format(date, 'MMM do yyyy HH:mm:ss') : '';
      }
    },
    {
      title: 'Name',
      render: (_, promotion) => (
        <a onClick={() => setSelectedPromotion(promotion)}>{promotion.metadata?.name}</a>
      )
    },
    {
      title: 'Created By',
      render: (_, promotion) => {
        const annotation = promotion.metadata?.annotations['kargo.akuity.io/create-actor'];
        const email = annotation ? annotation.split(':')[1] : 'N/A';

        return email || annotation;
      }
    },
    {
      title: 'Freight',
      render: (_, promotion) => (
        <Tooltip
          overlay={
            <Spin spinning={isLoadingFreight}>
              <div className='w-40 text-center truncate'>
                {(freightData?.result?.value as Freight)?.alias}
              </div>
            </Spin>
          }
          onOpenChange={() => {
            setCurFreight(promotion.spec?.freight);
          }}
        >
          <Link
            to={generatePath(paths.freight, {
              name: projectName,
              freightName: promotion.spec?.freight
            })}
          >
            {promotion.spec?.freight?.substring(0, 7)}
          </Link>
        </Tooltip>
      )
    },
    {
      title: '',
      render: (_, promotion, promotionIndex) => {
        const filteredUiPlugins = uiPlugins
          .filter((plugin) =>
            plugin.DeepLinkPlugin?.Promotion?.shouldRender({
              promotion,
              isLatestPromotion: promotionIndex === 0
            })
          )
          .map((plugin) => plugin.DeepLinkPlugin?.Promotion?.render);

        if (filteredUiPlugins?.length > 0) {
          return (
            <UiPluginHoles.DeepLinks.Promotion className='w-fit'>
              {filteredUiPlugins.map(
                (ApplyPlugin, idx) =>
                  ApplyPlugin && (
                    <ApplyPlugin
                      key={idx}
                      promotion={promotion}
                      isLatestPromotion={promotionIndex === 0}
                      unstable_argocdShardUrl={argocdShard?.url}
                    />
                  )
              )}
            </UiPluginHoles.DeepLinks.Promotion>
          );
        }

        return '-';
      }
    }
  ];

  return (
    <>
      <Table
        columns={columns}
        dataSource={promotions}
        size='small'
        pagination={{ hideOnSinglePage: true }}
        rowKey={(p) => p.metadata?.uid || ''}
        loading={isLoading}
      />

      {selectedPromotion && (
        <PromotionDetailsModal
          // @ts-expect-error // know that there will always be value available of this promotion
          // IMPORTANT: the reason why selectedPromotion is not used is because promotions are live while selectedPromotion snapshot at particular point
          promotion={promotions?.find(
            (p) => p?.metadata?.name === selectedPromotion?.metadata?.name
          )}
          visible={!!selectedPromotion}
          hide={() => setSelectedPromotion(undefined)}
          project={projectName || ''}
        />
      )}
    </>
  );
};

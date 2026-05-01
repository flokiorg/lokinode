import React from 'react';
import Import from '@/views/wallet/Import';
import New from '@/views/wallet/New';
import Private from '@/views/wallet/Private';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useTranslation } from '@/i18n/context';

function Tab() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col justify-center items-center flex-wrap w-full">
      <div className="text-[24px] text-white leading-[31px] text-center max-w-[380px] mb-[40px] font-headline font-semibold">
        {t('wallet.setup.title')}
      </div>
      <Tabs defaultValue="new" className="w-full max-w-[350px]">
        <TabsList className="grid w-full grid-cols-3 bg-secondary border border-gray-800">
          <TabsTrigger value="new">{t('wallet.setup.new')}</TabsTrigger>
          <TabsTrigger value="import">{t('wallet.setup.mnemonic')}</TabsTrigger>
          <TabsTrigger value="private">{t('wallet.setup.private')}</TabsTrigger>
        </TabsList>
        <TabsContent value="new" className="mt-6">
          <New />
        </TabsContent>
        <TabsContent value="import" className="mt-6">
          <Import />
        </TabsContent>
        <TabsContent value="private" className="mt-6">
          <Private />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default Tab;

import Loading from '@/components/Loading/Loading';
import { ConfirmButton } from '@/components/ConfirmButton/ConfirmButton';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n/context';
import { useWalletCreateStore } from '@/store/walletCreate';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';

export const MnemonicAlert = ({onSubmit}:{onSubmit:() => void}) => {
  const { t } = useTranslation();
  const { showMnemonicDialog, setShowMnemonicDialog, confirmLoading } = useWalletCreateStore()

  return (
    <Dialog open={showMnemonicDialog} onOpenChange={(open: boolean) => setShowMnemonicDialog(open)}>
      <DialogContent className="p-[18px] rounded-lg shadow-lg flex flex-col items-center justify-center w-[436px] gap-[16px] bg-secondary border-gray-800">
        <DialogHeader className="w-full">
          <div className="text-[18px] font-semibold text-white mb-[15px] font-headline">
            {t('wallet.mnemonic.notice')}
          </div>
          <div className="flex flex-row justify-center items-center gap-2">
            <AlertTriangle size={20} className="text-[#DA9526] shrink-0" />
            <div className="text-[16px] text-gray-300 leading-[24px]">
              {t('wallet.mnemonic.ensure')}
            </div>
          </div>
        </DialogHeader>
        <div className="flex flex-col px-[15px] py-[12px] leading-[21px] border border-[#DA9526] bg-[#DA9526]/10 rounded-md text-[#DA9526] gap-[12px] text-[16px] w-full">
          <div className="flex flex-row items-start">
            <span className="font-bold mr-2">•</span>
            <span>{t('wallet.mnemonic.point1')}</span>
          </div>
          <div className="flex flex-row items-start">
            <span className="font-bold mr-2">•</span>
            <span>{t('wallet.mnemonic.point2')}</span>
          </div>
          <div className="flex flex-row items-start">
            <span className="font-bold mr-2">•</span>
            <span>{t('wallet.mnemonic.point3')}</span>
          </div>
        </div>
        <div className="text-[#DA9526] text-sm font-medium flex flex-row justify-start text-start w-full mb-[10px]">
          {t('wallet.mnemonic.footer')}
        </div>
        <DialogFooter className="flex flex-row gap-4 w-full">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={()=>setShowMnemonicDialog(false)}
          >
            {t('wallet.mnemonic.back')}
          </Button>
          <ConfirmButton type="submit" onClick={onSubmit} content={t('wallet.mnemonic.confirm')} loading={confirmLoading} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
export default MnemonicAlert;

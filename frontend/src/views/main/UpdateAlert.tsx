import { useState } from 'react';
import { BrowserOpenURL } from '../../../wailsjs/runtime';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n/context';
import { useInfo } from '@/hooks/useInfo';
import { ArrowUpCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export const UpdateAlert = () => {
  const { t } = useTranslation();
  const { data: info } = useInfo();
  const [dismissed, setDismissed] = useState(false);

  const needsUpdate = !dismissed && info?.latestVersion && info?.version && info.latestVersion !== info.version;

  function dismiss() {
    localStorage.setItem('reminderTime', String(Date.now()));
    setDismissed(true);
  }

  // Respect snooze from localStorage
  const reminderTime = localStorage.getItem('reminderTime');
  if (reminderTime && Date.now() - Number(reminderTime) < 2 * 60 * 60 * 1000) {
    return null;
  }

  return (
    <Dialog open={!!needsUpdate} onOpenChange={open => !open && dismiss()}>
      <DialogContent className="p-[24px] rounded-2xl flex flex-col w-[350px] bg-[#1c1c1e] border border-white/[0.08]">
        <DialogHeader>
          <DialogTitle className="text-[16px] font-semibold text-white font-headline">
            {t('update.title')}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t('update.title')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-[12px] my-[12px]">
          <ArrowUpCircle size={20} className="mt-[2px] shrink-0 text-[#DA9526]" />
          <p className="text-gray-300 text-[14px] leading-[22px]">
            {t('update.body', { version: info?.latestVersion })}
          </p>
        </div>

        <DialogFooter className="flex flex-row gap-[8px]">
          <Button variant="secondary" className="flex-1" onClick={dismiss}>{t('update.later')}</Button>
          <Button
            className="flex-1 bg-[#DA9526] text-black hover:bg-[#c8871f] font-semibold"
            onClick={() => BrowserOpenURL(`https://github.com/flokiorg/lokinode/releases/tag/${info?.latestVersion}`)}
          >
            {t('update.now')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UpdateAlert;

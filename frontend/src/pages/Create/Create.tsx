import { useEffect } from 'react';
import Pwd from '@/views/wallet/Password';
import Tab from '@/views/wallet/Tab';
import { useWalletCreateStore } from '@/store/walletCreate';

function Create() {
  const { status, reset } = useWalletCreateStore();

  // Reset all wallet-creation state on every mount so stale values from a
  // previous attempt never bleed through.
  useEffect(() => { reset(); }, []);

  return (
    <div className="flex flex-col h-full items-center justify-center pt-[116px] w-full">
      {status === 'pwd' ? <Pwd /> : <Tab />}
    </div>
  );
}

export default Create;

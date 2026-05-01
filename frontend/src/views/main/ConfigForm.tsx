import React from 'react';
import { useNodeConfigStore } from '@/store/nodeConfig';
import { useTranslation } from '@/i18n/context';
import { Input } from '@/components/ui/input';

const DEFAULT_REST_CORS   = '*';
const DEFAULT_RPC_LISTEN  = '127.0.0.1:10005';
const DEFAULT_REST_LISTEN = '127.0.0.1:8080';

const ConfigForm = () => {
  const { t } = useTranslation();
  const {
    aliasName, setAliasName,
    restCors,  setRestCors,
    rpcListen, setRpcListen,
    restListen, setRestListen,
  } = useNodeConfigStore();

  const [aliasError, setAliasError] = React.useState(false);

  const fieldLabel = "text-gray-400 text-[11px] font-label uppercase tracking-[0.08em]";
  const inputBase  = "w-full bg-[#1c1c1e] border-white/[0.06] text-white placeholder:text-gray-400 focus:border-[#DA9526]/60 focus:ring-0 h-[38px]";

  return (
    <div className="flex flex-col w-full gap-[16px]">

      {/* Node alias */}
      <div className="flex flex-col gap-[6px]">
        <label className={fieldLabel}>{t('config.alias')}</label>
        <Input
          type="text"
          placeholder={t('config.alias_ph')}
          value={aliasName}
          onChange={e => { setAliasName(e.target.value); setAliasError(false); }}
          onBlur={() => setAliasError(!aliasName)}
          className={`${inputBase} ${aliasError ? 'border-red-500' : ''}`}
        />
        {aliasError && <span className="text-red-400 text-[11px]">{t('validation.required')}</span>}
      </div>

      {/* Network settings */}
      <div className="flex flex-col gap-[10px]">
        <label className={fieldLabel}>{t('config.network')}</label>

        <div className="flex flex-col gap-[4px]">
          <span className="text-gray-400 text-[10px] uppercase tracking-wide">{t('config.rest_cors')}</span>
          <Input
            type="text"
            className={inputBase}
            placeholder={DEFAULT_REST_CORS}
            value={restCors}
            onChange={e => setRestCors(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-[4px]">
          <span className="text-gray-400 text-[10px] uppercase tracking-wide">{t('config.rpc_listen')}</span>
          <Input
            type="text"
            className={inputBase}
            placeholder={DEFAULT_RPC_LISTEN}
            value={rpcListen}
            onChange={e => setRpcListen(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-[4px]">
          <span className="text-gray-400 text-[10px] uppercase tracking-wide">{t('config.rest_listen')}</span>
          <Input
            type="text"
            className={inputBase}
            placeholder={DEFAULT_REST_LISTEN}
            value={restListen}
            onChange={e => setRestListen(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
};

export default ConfigForm;

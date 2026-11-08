// Excerpts of next.vestmarkets.com /assets/index-rv9Op3JB.js (public page code, 08 Nov 2026), only the lines that name the endpoints.
ync(e,t)=>{const n=db()?.deviceKeyId,{data:s}=await PC.post("/v3/auth/account-token",{accountId:e},{head
C.interceptors.response.use(NC,kC({isPublic:!1}));const fTe="/v3/accounts",e9=2e5,EQ=e=>{let t
ount:!1,queryFn:n=>{const s=performance.now();return Je.get("/v3/accounts",{params:{active:!0,
eryFn:({queryKey:[n,s]})=>{const r=Date.now();return Je.get("/v3/positions/opened-orders").then(i=>XNe(i.data
eryFn:({queryKey:[n,s]})=>{const r=Date.now();return Je.get("/v3/positions/opened").then(i=>xke(i.data
,refetchOnMount:!1,queryKey:nJ,queryFn:({signal:e})=>Ar.get("/v3/exchangeInfo",{signal:e}).then(t=
.getState().getById(e,n)?.positionId,{data:r}=await Je.post("/v3/positions/cancel-order",{orderId:e},{accoun
oid 0:rP(a,i,r,e.orderType);try{const{data:u}=await Je.post("/v3/positions/append",e,{accountId:s});re
orderType);JN(e.positionId);try{const{data:l}=await Je.post("/v3/positions/close",e,{accountId:n});t?
rType),{accountId:a,...c}=e;try{const{data:l}=await Je.post("/v3/positions/open",c,{accountId:a});re
oid 0:rP(a,l,i,e.orderType);try{const{data:d}=await Je.post("/v3/positions/reduce",{...e,symbol:i},{ac
s not an exchange fee. See the <Docs>funding docs</Docs>."},"stop-loss":{title:"Stop-Loss U
制乘数现为 1。资金费在交易者之间相互支付，并非交易所收取的费用。详情请参阅<Docs>资金费文档</Docs>。"},"stop-loss":{title:"止损更新",body:
const qat={[gt.TAKE_PROFIT]:"take-profit",[gt.STOP_LOSS]:"stop-loss"}

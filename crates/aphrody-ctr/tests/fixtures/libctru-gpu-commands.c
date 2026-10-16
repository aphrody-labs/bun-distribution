u32* gpuCmdBuf;
u32 gpuCmdBufSize;
u32 gpuCmdBufOffset;

void GPUCMD_AddRawCommands(const u32* cmd, u32 size)
{
	if(!cmd || !size)return;

	memcpy(&gpuCmdBuf[gpuCmdBufOffset], cmd, size*4);
	gpuCmdBufOffset+=size;
}

static void GPUCMD_AddInternal(u32 header, const u32* param, u32 paramlength)
{
	if(!gpuCmdBuf || gpuCmdBufOffset+paramlength+1>gpuCmdBufSize)
		svcBreak(USERBREAK_PANIC); // Shouldn't happen.

	paramlength--;
	header|=(paramlength&0xff)<<20;

	gpuCmdBuf[gpuCmdBufOffset]=param ? param[0] : 0;
	gpuCmdBuf[gpuCmdBufOffset+1]=header;

	if(paramlength)
	{
		if(param)memcpy(&gpuCmdBuf[gpuCmdBufOffset+2], &param[1], paramlength*4);
		else     memset(&gpuCmdBuf[gpuCmdBufOffset+2], 0, paramlength*4);
	}

	gpuCmdBufOffset+=paramlength+2;

	if(paramlength&1)gpuCmdBuf[gpuCmdBufOffset++]=0x00000000; //alignment
}

void GPUCMD_Add(u32 header, const u32* param, u32 paramlength)
{
	if(!paramlength)paramlength=1;

	while(paramlength)
	{
		u32 remaining = paramlength > 0x100 ? 0x100 : paramlength;
		GPUCMD_AddInternal(header, param, remaining);
		param += remaining;
		paramlength -= remaining;
		if(header & BIT(31)) header += remaining;
	}
}

void GPUCMD_Split(u32** addr, u32* size)
{
	GPUCMD_AddWrite(GPUREG_FINALIZE, 0x12345678);
	if (gpuCmdBufOffset & 3)
		GPUCMD_AddWrite(GPUREG_FINALIZE, 0x12345678); // 16-byte align the buffer

	if (addr) *addr = gpuCmdBuf;
	if (size) *size = gpuCmdBufOffset;

	gpuCmdBuf       += gpuCmdBufOffset;
	gpuCmdBufSize   -= gpuCmdBufOffset;
	gpuCmdBufOffset  = 0;
}

void DVLE_GenerateOutmap(DVLE_s* dvle)
{
	if (!dvle) return;

	// Initialize outmap data
	memset(dvle->outmapData, 0x1F, sizeof(dvle->outmapData));
	dvle->outmapData[0] = 0;
	dvle->outmapMask    = 0;
	dvle->outmapMode    = 0;
	dvle->outmapClock   = 0;

	int i, j, k;
	for (i = 0; i < dvle->outTableSize; i ++)
	{
		int type = dvle->outTableData[i].type;
		int mask = dvle->outTableData[i].mask;
		int regID = dvle->outTableData[i].regID;
		u32* out = &dvle->outmapData[regID+1];

		if (!(dvle->outmapMask & BIT(regID)))
		{
			dvle->outmapMask |= BIT(regID);
			dvle->outmapData[0] ++;
		}

		int sem = 0x1F, num = 0;
		switch (type)
		{
			case RESULT_POSITION:   sem = 0x00; num = 4;                                                     break;
			case RESULT_NORMALQUAT: sem = 0x04; num = 4; dvle->outmapClock |= BIT(24);                       break;
			case RESULT_COLOR:      sem = 0x08; num = 4; dvle->outmapClock |= BIT(1);                        break;
			case RESULT_TEXCOORD0:  sem = 0x0C; num = 2; dvle->outmapClock |= BIT(8);  dvle->outmapMode = 1; break;
			case RESULT_TEXCOORD0W: sem = 0x10; num = 1; dvle->outmapClock |= BIT(16); dvle->outmapMode = 1; break;
			case RESULT_TEXCOORD1:  sem = 0x0E; num = 2; dvle->outmapClock |= BIT(9);  dvle->outmapMode = 1; break;
			case RESULT_TEXCOORD2:  sem = 0x16; num = 2; dvle->outmapClock |= BIT(10); dvle->outmapMode = 1; break;
			case RESULT_VIEW:       sem = 0x12; num = 3; dvle->outmapClock |= BIT(24);                       break;
			default: continue;
		}

		for (j = 0, k = 0; j < 4 && k < num; j ++)
		{
			if (mask & BIT(j))
			{
				*out &= ~(0xFF << (j*8));
				*out |= (sem++) << (j*8);
				k ++;
				if (type==RESULT_POSITION && k==3)
					dvle->outmapClock |= BIT(0);
			}
		}
	}
}

import { Button as B, Box, Stack, Typography, Modal, ThemeProvider } from "@mui/material";
import Card from "@mui/material/Card";
import React from "react";

export function Page() {
  return (
    <ThemeProvider theme={t}>
      <Box sx={{ p: 2 }} className="wrap">
        <Stack direction="row" spacing={2}>
          <Typography variant="h1">Titre</Typography>
          <B variant="outlined">Go</B>
        </Stack>
        <Modal open={open}>
          <div>contenu</div>
        </Modal>
        <Card>carte</Card>
      </Box>
    </ThemeProvider>
  );
}

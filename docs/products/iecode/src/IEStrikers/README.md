# IEStrikers
Decompilation of Inazuma Eleven Strikers
## Building
### Requirements
- DevkitPPC r38 or r41, other versions are not tested
> **Note**
> on windows the environment variables get set incorrectly for devkitpro, 
> change it to the path where you stored devkitPro
- Ninja(Optional: add ninja to your environment variables)
- Python 3.8+

### Instructions
- Dump a copy of the Inazuma Eleven Go Strikers 2013 and extract `main.dol`
- rename `main.dol` to `InazumaWii.dol`
- clone the repo using `git clone https://github.com/SwareJonge/IEStrikers/ --recursive`
- Place `InazumaWii.dol` in `orig/GOStrikers2013/`
- Place the required compilers in `tools`
- (first time only) From the IECODE root, install the tool dependencies with `uv sync --package iestrikers-tools`
- Run `uv run --package iestrikers-tools python configure.py` you also need to run this when you made a change to `dol_slices.yml`
- Run `ninja`

### Bugs
- currently ctors and extab don't work, this might get fixed in the future

## Credits
- [kiwi](https://github.com/kiwi515) for [open_rvl](https://github.com/kiwi515/open_rvl)
- [Seeky](https://github.com/SeekyCt) for helping me setting it all up

